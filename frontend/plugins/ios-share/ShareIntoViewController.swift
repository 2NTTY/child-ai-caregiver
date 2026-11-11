import UIKit
import UniformTypeIdentifiers
import Darwin

private enum ShareFailure: LocalizedError {
  case unavailable, busy, full, unsupported, tooLarge
  var errorDescription: String? {
    switch self {
    case .unavailable: return "未能保存這次分享，請從來源再試。"
    case .busy: return "正在接收另一項分享，請稍後再試。"
    case .full: return "請先在育有方處理待接收的分享，再加入新項目。"
    case .unsupported: return "未能讀取其中一項內容，請重新選擇分享項目。"
    case .tooLarge: return "這次分享超出可接收的大小，請分開分享或選擇較小的檔案。"
    }
  }
}

// Expo supplies the containing target and its App Group. Publish a batch by a single
// same-volume rename so the app never sees incomplete text, attachments or copies.
private struct ShareWriter {
  let root: URL
  private let fm = FileManager.default
  private let itemLimit = 20
  private let maxBatchBytes = 256 * 1024 * 1024

  init() throws {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "AppGroupId") as? String,
          let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
    else { throw ShareFailure.unavailable }
    root = container.appendingPathComponent("incoming-v1", isDirectory: true)
  }

  func save(_ providers: [NSItemProvider]) async throws {
    guard !providers.isEmpty else { throw ShareFailure.unsupported }
    guard providers.count <= itemLimit else { throw ShareFailure.full }
    try fm.createDirectory(at: root, withIntermediateDirectories: true,
                           attributes: [.protectionKey: FileProtectionType.complete])
    var directory = root
    var flags = URLResourceValues()
    flags.isExcludedFromBackup = true
    try directory.setResourceValues(flags)
    let lock = open(root.appendingPathComponent(".writer").path, O_CREAT | O_RDWR, 0o600)
    guard lock >= 0 else { throw ShareFailure.unavailable }
    defer { Darwin.close(lock) }
    guard flock(lock, LOCK_EX | LOCK_NB) == 0 else { throw ShareFailure.busy }
    let epoch = try currentEpoch()
    var pending = 0
    for existing in try fm.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) {
      if existing.lastPathComponent.hasPrefix("staging-") {
        // The writer lock is exclusive, so leftovers belong to an interrupted extension.
        try fm.removeItem(at: existing)
      } else if existing.lastPathComponent.hasPrefix("ready-") {
        do {
          let names = try fm.contentsOfDirectory(atPath: existing.path)
          pending += names.filter { Int($0) != nil }.count
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile { continue }
      }
    }
    guard pending + providers.count <= itemLimit else { throw ShareFailure.full }
    let id = UUID().uuidString.lowercased()
    let stage = root.appendingPathComponent("staging-" + id, isDirectory: true)
    try fm.createDirectory(at: stage, withIntermediateDirectories: false)
    defer { try? fm.removeItem(at: stage) }
    try epoch.write(to: stage.appendingPathComponent("epoch"), atomically: true, encoding: .utf8)
    var remaining = maxBatchBytes
    for (index, provider) in providers.enumerated() {
      try Task.checkCancellation()
      let item = stage.appendingPathComponent(String(index), isDirectory: true)
      try fm.createDirectory(at: item, withIntermediateDirectories: false)
      let (metadata, bytes) = try await receive(provider, into: item, remaining: remaining)
      guard bytes <= remaining else { throw ShareFailure.tooLarge }
      remaining -= bytes
      let manifest = try JSONEncoder().encode(metadata)
      guard manifest.count <= 48 * 1024 else { throw ShareFailure.tooLarge }
      try manifest.write(to: item.appendingPathComponent("item.json"), options: .atomic)
    }
    try Task.checkCancellation()
    guard try currentEpoch() == epoch else { throw ShareFailure.unavailable }
    try fm.moveItem(at: stage, to: root.appendingPathComponent("ready-" + id))
  }

  private func currentEpoch() throws -> String {
    guard !fm.fileExists(atPath: root.appendingPathComponent("clear-pending.json").path) else { throw ShareFailure.unavailable }
    let file = root.appendingPathComponent("device-epoch")
    guard fm.fileExists(atPath: file.path) else { return "initial" }
    let value = try String(contentsOf: file, encoding: .utf8)
    guard let id = UUID(uuidString: value), id.uuidString.lowercased() == value else { throw ShareFailure.unavailable }
    return value
  }

  private func receive(_ provider: NSItemProvider, into item: URL, remaining: Int) async throws -> ([String:String], Int) {
    let types = provider.registeredTypeIdentifiers.compactMap { UTType($0) }
    let isFile = provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier)
    if !isFile, provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
      let url = try await object(NSURL.self, from: provider) as URL
      guard !url.isFileURL else { throw ShareFailure.unsupported }
      return try text(url.absoluteString, kind: "url")
    }
    if !isFile, types.contains(where: { $0.conforms(to: .plainText) }) {
      return try text(try await object(NSString.self, from: provider) as String, kind: "text")
    }
    let type = types.first { $0.conforms(to: .data) && !$0.conforms(to: .url) }
    let body = item.appendingPathComponent("body", isDirectory: true)
    try fm.createDirectory(at: body, withIntermediateDirectories: false)
    if let type {
      // The provider can delete its temporary representation when the callback returns.
      return try await withCheckedThrowingContinuation { continuation in
        provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, _ in
          continuation.resume(with: Result {
            guard let url else { throw ShareFailure.unsupported }
            return try self.copy(url, type: type, suggested: provider.suggestedName, into: body, remaining: remaining)
          })
        }
      }
    }
    guard isFile else { throw ShareFailure.unsupported }
    let url = try await object(NSURL.self, from: provider) as URL
    guard url.isFileURL else { throw ShareFailure.unsupported }
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    // A provider may already have put its representation in the extension's temporary directory.
    if !scoped {
      let temporary = fm.temporaryDirectory.resolvingSymlinksInPath().standardizedFileURL.path
      guard url.resolvingSymlinksInPath().standardizedFileURL.path.hasPrefix(temporary + "/") else { throw ShareFailure.unsupported }
    }
    return try copy(url, type: UTType(filenameExtension: url.pathExtension) ?? .data,
                    suggested: url.lastPathComponent, into: body, remaining: remaining)
  }

  private func object<T: NSItemProviderReading>(_ type: T.Type, from provider: NSItemProvider) async throws -> T {
    try await withCheckedThrowingContinuation { continuation in
      provider.loadObject(ofClass: type) { value, _ in
        if let object = value as? T { continuation.resume(returning: object) }
        else { continuation.resume(throwing: ShareFailure.unsupported) }
      }
    }
  }

  private func text(_ value: String, kind: String) throws -> ([String:String], Int) {
    guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !value.utf8.contains(0) else { throw ShareFailure.unsupported }
    guard value.utf16.count <= 10_000 else { throw ShareFailure.tooLarge }
    return (["shareType": kind, "text": value], value.utf8.count)
  }

  private func copy(_ url: URL, type: UTType, suggested: String?, into body: URL, remaining: Int) throws -> ([String:String], Int) {
    let attrs = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
    guard url.isFileURL, attrs.isRegularFile == true, attrs.isSymbolicLink != true,
          let size = attrs.fileSize, size > 0 else { throw ShareFailure.unsupported }
    var name = suggested?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if name.isEmpty { name = url.lastPathComponent }
    if (name as NSString).pathExtension.isEmpty {
      let ext = url.pathExtension.isEmpty ? type.preferredFilenameExtension : url.pathExtension
      if let ext { name += "." + ext }
    }
    let invalid = CharacterSet(charactersIn: "/\\:").union(.controlCharacters)
    guard !name.isEmpty, !name.hasPrefix("."), name.utf16.count <= 200, name.utf8.count <= 255,
          name.range(of: "%[0-9a-fA-F]{2}", options: .regularExpression) == nil,
          name.rangeOfCharacter(from: invalid) == nil else { throw ShareFailure.unsupported }
    let ext = (name as NSString).pathExtension.lowercased()
    let limit = ext == "zip" ? maxBatchBytes : 20 * 1024 * 1024
    guard size <= limit, size <= remaining else { throw ShareFailure.tooLarge }
    let file = body.appendingPathComponent(name)
    try fm.copyItem(at: url, to: file)
    let saved = try file.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
    guard saved.fileSize == size, saved.isRegularFile == true, saved.isSymbolicLink != true else { throw ShareFailure.unavailable }
    let contentType = type == .data || type == .item ? (UTType(filenameExtension: ext) ?? type) : type
    let kind = contentType.conforms(to: .image) ? "image" : contentType.conforms(to: .audio) ? "audio" :
      contentType.conforms(to: .movie) ? "video" : "file"
    return (["shareType": kind, "fileName": name, "mimeType": contentType.preferredMIMEType ?? "application/octet-stream"], size)
  }
}

final class ShareIntoViewController: UIViewController {
  private var receiving: Task<Void, Never>?
  private let statusLabel = UILabel()

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    statusLabel.numberOfLines = 0
    statusLabel.textAlignment = .center
    statusLabel.text = "正在將分享存到此裝置…"
    statusLabel.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(statusLabel)
    NSLayoutConstraint.activate([statusLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      statusLabel.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
      statusLabel.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor)])
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard receiving == nil, let context = extensionContext else { return }
    let providers = (context.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
    receiving = Task {
      do {
        try await ShareWriter().save(providers)
        context.completeRequest(returningItems: nil, completionHandler: nil)
      } catch {
        statusLabel.text = nil
        let alert = UIAlertController(title: "未能接收分享", message: (error as? ShareFailure)?.errorDescription ??
          ShareFailure.unavailable.errorDescription, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "返回", style: .default) { _ in context.cancelRequest(withError: error) })
        present(alert, animated: true)
      }
    }
  }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    if isBeingDismissed { receiving?.cancel() }
  }
}
