export function SkipToContent() {
  return <a className="app-skip-link" href="#main-content" onClick={event => {
    const target = document.getElementById("main-content");
    if (!target) return;
    event.preventDefault(); target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "nearest" });
  }}>跳到主要內容</a>;
}
