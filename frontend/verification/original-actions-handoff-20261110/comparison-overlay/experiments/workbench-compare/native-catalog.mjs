/**
 * Source-bound metadata only. No product imports, state owner, storage, mount or
 * release authority. Compare means source comparison. Prospective composition
 * refers only to the named bounded source adapter, never runtime admission.
 */
export const VARIANT_IDS = Object.freeze(['original', 'harbour', 'care', 'handbook', 'fourth']);
export const TASK_SLOT_IDS = Object.freeze(['header-actions', 'filters', 'date-list', 'calendar-layout']);
// Logical repository paths only. Physical locations belong in private test inputs.
const FILE_PINS = {
  "handbook-presentation01": {
  "frontend/src/preview/tasks-handbook-presentation/HandbookDateList.tsx": "0b793011e984746dd9d005e9e718b4dd702092956347af560c8f37b4524a366c",
  "frontend/src/preview/tasks-handbook-presentation/HandbookTaskRowContent.tsx": "3b801597e25e745fbcb3511cc49161195bbedababa3b7187dc29befece064593",
  "frontend/src/preview/tasks-handbook-presentation/HandbookTasksHeader.tsx": "bce030b8f2f82c0c007ea4272d8ebe82d9abf74ec646c08056be4065b83648b7",
  "frontend/src/preview/tasks-handbook-presentation/presentation.ts": "6827d59ce9045292ac04587e70739b6df9409c5603bbb46cdc8a6be79f6aac80",
  "frontend/src/preview/tasks-handbook-presentation/source-theme.ts": "4b5916e8df5156a34d9dee8d767557593cc8824994fcf1e88594514e8ee3f972",
  "frontend/src/preview/tasks-handbook-presentation/styles.ts": "5148aa86e2678d00543a2d96756dd41674f4d1cc480a0e56b4c586b66300bd90"
},
  "filter-calendar-presentation01": {
  "frontend/src/components/tasks/presentation/CareWorkspaceSwitch.tsx": "c064f5a07647079135978f6ead0971d5181fe0eae013065120282277a7337f53",
  "frontend/src/components/tasks/presentation/TasksCalendarLayoutPresentation.tsx": "bdcdaef10cf83a99b3c30d61c562883dedd56f0b789b70bd1d366b10f6f18d82",
  "frontend/src/components/tasks/presentation/TasksCalendarPresentation.tsx": "30a90e62f83b887dd957dc85a0b5c2ba464f3707605c9bdf8ed802503131b9e9",
  "frontend/src/components/tasks/presentation/TasksFiltersPresentation.tsx": "94210d4a00e5765b7c5b0dd26f5b02e65b78a5a84401ac1e95bb8138bf66ee2c",
  "frontend/src/components/tasks/presentation/contracts.ts": "452674044227b493fd4f4df6e097867312ff82154920d1665a0cb0bf4ce0c3d1",
  "frontend/src/components/tasks/presentation/useCareManualTabControls.ts": "ea1f72ee1fece34acbc1e2bdfaa3c1f33bd4c83ae06b3a66cb2ad0679d10f075"
},
  "harbour-h629": {
    "frontend/src/components/tasks/TasksView.tsx": "8483cfd203691284cdaf7550e7c5adeb6418f00242a38e684d19f0b25a8e9fd4",
    "frontend/src/components/tasks/TasksCalendar.tsx": "3d282ea49db3bec1d0009d580ae6f9cc2cdf1a82e006bba6b101b3cacd43e5c0",
    "frontend/src/components/tasks/task-calendar.ts": "b6bd0b7d763eb0f21b3d4c71685036ec04a5c2bd7d78532ae7a1713d02c386a4",
    "frontend/src/components/tasks/TaskListRow.tsx": "e1bc8e856f315176ba8b39fc9813c115c783c7d8f4d7e34fa62df472630a8b80",
    "frontend/src/components/tasks/TaskForm.tsx": "e588a3bde2025d0662924924233814deb9e59e97a5c5d5c70c9ff3bc517b6b79",
    "frontend/src/components/tasks/TaskDetail.tsx": "8b8ed55eecc3cef814098f7cadf31ee42a74b37683ed6edef0a060406e368791",
    "frontend/src/components/tasks/task-form.ts": "5a40a277b2a95f588410999c51185a789d02c8a5f8f5b09378829ceb968dbb0f",
    "frontend/src/components/tasks/TaskHistoryView.tsx": "d2c190c55afaae55d39ba59f20b5d93cd9e4f0a4bfcc004512ce9614fe2c6912",
    "frontend/src/screens/tasksScreen.tsx": "8f363e127d12a7db13bd0d2b1e7645450d0e6f35e7a280d5f5884b5ebb297dab",
    "frontend/src/workspaces/TasksWorkspace.tsx": "35b350e164255a1beac5a965e83397a102af72b271f3307c47d463f399cb1c68",
    "frontend/src/components/FormDialog.tsx": "bfb837e69a11ac4f475cb7862ae8dd85768ac3ed29413a680f9443376502a240",
    "frontend/src/task-view-model.ts": "7c99fff1bc34afa2db07961574ab6ac7c8bd7f7bcfc1f98b309faeb49b87191e",
    "frontend/src/theme.ts": "5fa570023e71dcbab4c5cbcbd69865dba2d38ec3defb4e21db5ac15d57f50c23",
    "package-lock.json": "42c936ee3bef938c7def0ef376a724ac0bf21470981ef9dbd2b9a3eeb181e119",
    "frontend/src/preview/PreviewNavigationGuard.tsx": "242249ebe9d32dec501c4040c7355fb896daa1afa190abf96c9cc75b3bbdbd03",
    "frontend/src/production/ProductionProvider.tsx": "5cc59ab803824647736648f45ed522107bce0f5e8e83220eaf5cd3b3d6ae6cd1",
    "frontend/src/navigation/route-state.ts": "76d74d8cf908f645db2e70d3b46613042e5d22c81f50ed42110f829804473e55",
    "frontend/src/navigation/RoutePresentation.tsx": "b29db6ca37c987551de9ea682ca50a4efaa54bfa16a86aefc098bd4312c4cceb",
    "frontend/src/navigation/useRouteNavigation.ts": "10e28c032ca49f78337e7e27f675286268cabf740353c3d94866fc9087d74920",
    "frontend/src/components/workspace/Workspace.tsx": "27a22edbc27963e8d0d21fff8480d973209bfabe609db62188723d152b92a629"
  },
  "fourth-f599": {
    "frontend/src/components/tasks/TasksView.tsx": "f19ff82be6aa169991cb80cae336530704ee67f64b4d3c8db3597266d89b1fb8",
    "frontend/src/components/tasks/TasksCalendar.tsx": "1cd31a02f3520ac656201f3dc450e801b3d69b835fd6bab422457774eedca3da",
    "frontend/src/components/tasks/task-calendar.ts": "b6bd0b7d763eb0f21b3d4c71685036ec04a5c2bd7d78532ae7a1713d02c386a4",
    "frontend/src/components/tasks/TaskListRow.tsx": "8057af9ef2be9ba80000dc6519ad83792c012c1d926a2bb1d9838dae1dce8822",
    "frontend/src/components/tasks/TaskForm.tsx": "9108275750c71187dc0868df78381be4a50d99a1f69fe1d5ab9ecea1f1b01f70",
    "frontend/src/components/tasks/TaskDetail.tsx": "bbe798606b24b9567a4d0316a1beebfa0bff1bcf84d10af410d339138ea28ea7",
    "frontend/src/components/tasks/task-form.ts": "5a40a277b2a95f588410999c51185a789d02c8a5f8f5b09378829ceb968dbb0f",
    "frontend/src/components/tasks/TaskHistoryView.tsx": "093e81f37ae668d3a70348d67b5a35ebce4490a970a248913dd1b5b1b8b2bea3",
    "frontend/src/screens/tasksScreen.tsx": "c5e9edb39172c1d5283ffaf4243afbab57dc57ac9ad65f9efa7e5fe33f5ddc0f",
    "frontend/src/workspaces/TasksWorkspace.tsx": "35b350e164255a1beac5a965e83397a102af72b271f3307c47d463f399cb1c68",
    "frontend/src/components/FormDialog.tsx": "df249cd887c268ba56f1649ac4f275ac8922b249ef4b4bb650b5001f5ff25af5",
    "frontend/src/task-view-model.ts": "7ba37779456c46f1f852f53a6e30e208eea4b7a957f04c31b63d2f4ff078cdd2",
    "frontend/src/theme.ts": "3f8b4a0424e8b4807bb7be71d00e93d0c2c41a8f22c983de9e0bb1ce68f59404",
    "package-lock.json": "42c936ee3bef938c7def0ef376a724ac0bf21470981ef9dbd2b9a3eeb181e119",
    "frontend/src/preview/PreviewNavigationGuard.tsx": "07729e470e321a2a02e72238c38ef5db5ede861386f3b3b623d23bc9dff9f455",
    "frontend/src/production/ProductionProvider.tsx": "12efbb40b773fb18e8f9b5a531f8fb3f0bb27b49f65ea26aaaa8f5abf5473332"
  },
  "care-520d4c88": {
    "frontend/src/components/tasks/TasksView.tsx": "d91cab2a10babbbbcd0c92f2673362228cbdaea2731a254b4d2bbca0d085a73d",
    "frontend/src/components/tasks/TasksCalendar.tsx": "73e04fc8420aa93dfbf8dccba6918479d9a577066c48aceb7d129fa4158eb635",
    "frontend/src/components/tasks/task-calendar.ts": "b6bd0b7d763eb0f21b3d4c71685036ec04a5c2bd7d78532ae7a1713d02c386a4",
    "frontend/src/components/tasks/TaskListRow.tsx": "0a7f40c135eb8597ae2f4baf48fb7aae623fb5aef4ce27b365c2d7f79efa8479",
    "frontend/src/components/tasks/TaskForm.tsx": "f9f1e22cdd7830573d0d41785b24f2c8140239b74d33a68b9770ee8ccdcf954c",
    "frontend/src/components/tasks/TaskDetail.tsx": "dfcb883141082402cef942597361d9bdaa88caeb692f4a9cfdda067cb93dce9c",
    "frontend/src/components/tasks/task-form.ts": "5a40a277b2a95f588410999c51185a789d02c8a5f8f5b09378829ceb968dbb0f",
    "frontend/src/components/tasks/TaskHistoryView.tsx": "dea53ba89e908a63b1bbf03b159d63660378912010559b974fc73e66311ad13a",
    "frontend/src/screens/tasksScreen.tsx": "ac0b35e693d8e30cadc73dab29e02ad241d031fc6eb3a2e5d1918414e89c4345",
    "frontend/src/workspaces/TasksWorkspace.tsx": "35b350e164255a1beac5a965e83397a102af72b271f3307c47d463f399cb1c68",
    "frontend/src/components/FormDialog.tsx": "8740475404895db5ac38128d13855081cd2223bf7a56455944e0508a45e9ed28",
    "frontend/src/task-view-model.ts": "ea857535441e3b0d4cfdfb4f48ceacc7e58bd3fa1db4eb79be9d11a80d75a9f8",
    "frontend/src/theme.ts": "b65c1463c7396e23cf6da65320b609cbe916d2d79e8e12ee70cd689b84e75a3a",
    "package-lock.json": "42c936ee3bef938c7def0ef376a724ac0bf21470981ef9dbd2b9a3eeb181e119",
    "frontend/src/preview/PreviewNavigationGuard.tsx": "b1ff7382d2ef1cf3dab7c9a042b098628fe7a8bb2f4c0ba8cf990dc8c74fff2d",
    "frontend/src/production/ProductionProvider.tsx": "71762f6ca264f786e85590f19fa2f315f9fae3978957b370ce203e8f079bce10",
    "frontend/src/navigation/route-state.ts": "82f5b2bf16ac4d737386a39af28ff8e6e3ea603497047cdfc68286467f592b8d",
    "frontend/src/components/tasks/TaskWorkspaceParts.tsx": "9510c52625ad95d7f439ff8b6979b993d4860e5716f807baa1ddee266db1130f",
    "frontend/src/components/workspace/Workspace.tsx": "0967e78bdc5f9d0bd75ec4d2db4d5ba0ac995a21a3d69c8eec130eef56f6ab86",
    "frontend/src/components/workspace/WorkspaceSwitch.tsx": "66cb7e0c226dd08a9df82d95ab925e73d3b7e27f0fcb090c204fbb71c9ebb21c",
    "frontend/src/navigation/usePrivateQuery.ts": "e6893ffb902d71667424ecf0333f4c55b4ab5a04c1c9ad0ad865b988edd9b8c6",
    "frontend/src/navigation/useScopedRouteState.ts": "017a1e5b2f3c9cf527fcb5b92b874baf78221335a5d0156b95cf1704f6095773",
    "frontend/src/navigation/useGuardedRoute.ts": "2a7c7294b5feb41e74206ca79104dfc04abafab03aeb8d607447602087146601"
  },
  "handbook-72a00c86": {
    "frontend/src/components/tasks/TasksView.tsx": "f93a8a2ab88a917a78fe4293cc0adef098a16b86f281e7df1e1d5e214ce7a7d8",
    "frontend/src/components/tasks/TasksCalendar.tsx": "5ccdbc8a7d4bb1d86566c17445510b63621a7742c23ab43a463af279bf8b2eb4",
    "frontend/src/components/tasks/task-calendar.ts": "b6bd0b7d763eb0f21b3d4c71685036ec04a5c2bd7d78532ae7a1713d02c386a4",
    "frontend/src/components/tasks/TaskListRow.tsx": "0431b9cc97f6563e2607e740339731cf20c88bb2169d4be2d8517f771526beb8",
    "frontend/src/components/tasks/TaskForm.tsx": "c13fdbb6bcd627cdd14b2a13184b1d9cd96d9769bc5a0f50231c840314367739",
    "frontend/src/components/tasks/TaskDetail.tsx": "438525acad8c253883cdd507c05422d4a7ea4d5d0c349c1a7c00d9c651e460c1",
    "frontend/src/components/tasks/task-form.ts": "5a40a277b2a95f588410999c51185a789d02c8a5f8f5b09378829ceb968dbb0f",
    "frontend/src/components/tasks/TaskHistoryView.tsx": "62a4e671dbeef87c1ecc5718ebf98a8aec3970765bb922d804452b0e2f4521e2",
    "frontend/src/screens/tasksScreen.tsx": "aba3d2fed172bc1c896c0c9cafeeee4c1a5b474da8dd4bc11b97530b9fe8eac8",
    "frontend/src/workspaces/TasksWorkspace.tsx": "35b350e164255a1beac5a965e83397a102af72b271f3307c47d463f399cb1c68",
    "frontend/src/components/FormDialog.tsx": "19150ef54beb3983c5bbb6cfab7ba144d1aa95565799c122fa84989c58a03fb4",
    "frontend/src/task-view-model.ts": "7ba37779456c46f1f852f53a6e30e208eea4b7a957f04c31b63d2f4ff078cdd2",
    "frontend/src/theme.ts": "545826ca8018608a29cee78d4e845a0ffc0023baf326e1ca619f0321f06ddb80",
    "package-lock.json": "42c936ee3bef938c7def0ef376a724ac0bf21470981ef9dbd2b9a3eeb181e119",
    "frontend/src/preview/PreviewNavigationGuard.tsx": "7bc03fed3bf2519044fba1aa5d31d84445fc4848af42672cdd1654d8b3fb9c33",
    "frontend/src/production/ProductionProvider.tsx": "57f1ef9ffda7950c3e943f37a7c7f64af98de69da6ed61bdc6990a164bf0876d",
    "frontend/src/navigation/route-state.ts": "7b998ddb9fac53820324f69c17f99ea769920db0693c12b2c3326aeb91fb8d09",
    "frontend/src/navigation/NavigationAuthority.tsx": "29c34af57ae455ca6d28aafe1a008991bf3c102048a89bd2aa0deb02f7b6d84e",
    "frontend/src/components/journal/JournalLayout.tsx": "257e0e21f3ea284d8f3bc56444301627794cf77bd4420e85b93158acd91d9410"
  },
  "hf01-v1": {
    "frontend/src/preview/task-header-actions-hf01/selection.ts": "cb924ef6399c54e6e457f361e472b64ecb36f669788af5bac341083e387c51d0",
    "frontend/src/components/tasks/TasksHeaderActionsHF01.tsx": "1bb53ad0619abb9a78af80bb0865e563f23f5a03b7c756283a7c13bbd6a2641a",
    "frontend/src/preview/task-header-actions-hf01/HeaderActionsHF01FocusBoundary.tsx": "8c23b0e15026e0b92d9ec351e7d3b97618f147035567e5e13074782f049ccfbf",
    "frontend/src/preview/task-header-actions-hf01/TaskHeaderActionsHF01Control.tsx": "5e7386fe8169d8518e51c21a6fc3ded48097c945554f9bbe02eeb7d7cbde93e7",
    "frontend/src/preview/task-header-actions-hf01/save-authority.ts": "2c3f724aa2b6637edeeb35c6600df45d04d2ea29019b5d0f16ef3b96e8e73fdb",
    "frontend/src/preview/task-header-actions-hf01/recipe-storage.ts": "2de9f3ab8c5cc36e2dd5da035224411ff2e0df42d130572468ed64f42de59bd4"
  },
  "row-appearance-source01-20261108": {
    "frontend/src/components/tasks/TaskListRow.tsx": "4c21e1c8ac185209a140574d3d7b81741da364fadae4405a39c3453bd4edf005",
    "frontend/src/components/tasks/TasksView.tsx": "50787bada67f8250a086f117d137a06346e3e88c82d24f4c19dd3197ec221f2d"
  }
};
const HISTORICAL_MISSING_INPUTS = [
  {
    "path": "assets/images/after-school-routine.png",
    "sha256": "07ad4f410bf1ee6363b5cc89974c135cf9a8d04f3e3318583c83866bd66be460",
    "bytes": 2373164
  },
  {
    "path": "assets/images/caregiver-handover.png",
    "sha256": "b0d90d595da7d233cf0d5d36cff706ff1dcdede4680e9a3427adc462156f07fe",
    "bytes": 2767858
  },
  {
    "path": "assets/images/everyday-recording.png",
    "sha256": "70e2f8ccfb1ead34578443c1909e66685c7ea7f5a85c95a6085f3c954aa33044",
    "bytes": 2868982
  },
  {
    "path": "assets/images/harbour-family-hero.png",
    "sha256": "d2a072b0e68f4e825b50ab95b6074072b3cc847e40b9a08d113a4fd3c8316a9c",
    "bytes": 2335736
  },
  {
    "path": "assets/images/quiet-evening.png",
    "sha256": "7af6f1538b2acb87f0c4aab7d0c88134e3187744b365b3043a0a4c1702db1dd9",
    "bytes": 2505727
  },
  {
    "path": "assets/images/visit-preparation.png",
    "sha256": "cfc6ff2bc735d170caf35d265fe00f3277b9a0e3d55e7c0911ae0948ff60f748",
    "bytes": 2700493
  }
];
const ROW_DEPENDENCIES_FINGERPRINT = '1ac29f0b4afd027fa4d74b014112d7a9cdb36e80dd67d69154820b8d52ff2df0';
const SOURCE_IDENTITIES = {
  harbour: {
    kind: 'restored-assembly', sourceId: 'harbour-h629', appCommit: null,
    baseCommit: '4050c0a16d0a9735923434abc9749ecd416d7926',
    baseTree: 'fcc2393ea5f6bf6963fbf9b281f24bd02de76ea2',
    payloadCommit: '384a056f749f583ac92416c66dbe10f0e0fea6be',
    assemblyMembersSha256: '3f1fbfbe61217f75898e88276cb06e203d19c7ecf54c4febd4018e64329cc3e1',
    assemblyMemberCount: 629,
  },
  fourth: {
    kind: 'restored-assembly', sourceId: 'fourth-f599', appCommit: null,
    baseCommit: '76493c5e0747cb5da908fdb708879fd96509d093',
    baseTree: 'bf3ea11faf2bc58f664518c79575686ebb2bba84',
    payloadCommit: '384a056f749f583ac92416c66dbe10f0e0fea6be',
    assemblyMembersSha256: '690eedec12c76940c236b9f5317783fd835b679dd14a49d1654bd09298d0d9bc',
    assemblyMemberCount: 599,
  },
  care: {
    kind: 'historical-build-projection', sourceId: 'care-520d4c88',
    appCommit: '520d4c88a74faf460a464c38931cd9e1a84e0ec8',
    sourceTree: 'c0abef888f7bf10054a0b7b07cfc85b78b259073',
    expectedProjectedRowsSha256: 'c5cd1d3957ba92c99af3e74797082a6139912970328b918fc4f677a1a975e17a',
    restoredProjectionCount: 664, expectedProjectionCount: 670,
  },
  handbook: {
    kind: 'historical-build-projection', sourceId: 'handbook-72a00c86',
    appCommit: '72a00c860118e254e05249b471efb2a676aaaa42',
    sourceTree: '8af71f2826cec47d5625053b68b87aba2ab52722',
    expectedProjectedRowsSha256: '4af8d68f9014c84cf22e94793a0b21126578f24f9f38490f86c9f9e740b44ed5',
    restoredProjectionCount: 680, expectedProjectionCount: 686,
  },
};
const ORIGINAL_HISTORICAL_POINTER = {
  kind: 'composite', appCommit: null,
  sourceTree: 'de0cbacb583c923fba8f88f27fd5f6b8d5409c1c',
  recipeSha256: 'e49b453d98d3bcb34ea51bb67d068078d90e9c50c8862ae70b81f3bbe237074b',
};
const LABELS = {original:'Original', harbour:'Harbour', care:'Care', handbook:'Handbook', fourth:'Fourth'};
const SLOT_LABELS = {'header-actions':'頁首與操作', filters:'分類與篩選', 'date-list':'日期分組與清單', 'calendar-layout':'月曆與布局'};
const TASKS_VIEW = 'frontend/src/components/tasks/TasksView.tsx';
const TASKS_SCREEN = 'frontend/src/screens/tasksScreen.tsx';
const WORKSPACE = 'frontend/src/workspaces/TasksWorkspace.tsx';
const ROW = 'frontend/src/components/tasks/TaskListRow.tsx';
const CALENDAR = 'frontend/src/components/tasks/TasksCalendar.tsx';
const PROJECTION = 'frontend/src/components/tasks/task-calendar.ts';
const OWNER = 'tasks-single-owner-v1';
const DIFFERENCES = {
  original: {
    state:'Current source is unavailable.', header:'Current Original source and global theme are unavailable.',
    layout:'Current Original calendar/list source is unavailable.',
  },
  harbour: {
    state:'tasksScreen route state; TasksView local route fallback; RoutePresentation private query and scroll.',
    header:'Workspace heading remains host-owned; create, assistant, history actions; compact other-actions disclosure.',
    layout:'TasksView calendar disclosure; route day/month feed TasksCalendar; wide aside and compact disclosure have separate breakpoints.',
  },
  fourth: {
    state:'TasksView local tab, filter, query, page, selectedDay and calendarMonth state.',
    header:'Assistant, manual-create, history order; compact actions disclosure. The H-hosted adapter covers only this action region.',
    layout:'TasksView local calendar state and disclosure; TasksCalendar receives controlled day/month callbacks.',
  },
  care: {
    state:'tasksScreen scoped route/private query and guarded close intent; TasksView receives route/query callbacks.',
    header:'Workspace.Root heading/actions and WorkspaceSwitch classification remain source-owned.',
    layout:'TasksView disclosure with screen-owned route day/month; task rows retain source route links.',
  },
  handbook: {
    state:'tasksScreen focused NavigationAuthority route; TasksView private list query and local fallback state.',
    header:'JournalHeading contains source actions; no header adapter is admitted.',
    layout:'Source calendar/list arrangement; screen authority gates route changes and close acknowledgement.',
  },
};
const EXISTING_LANES = [
  {id:'TC01', ownerStatus:'unknown', injectable:false, role:'Independent filter/query/day/page/window projection owner; preserve.'},
  {id:'C01', ownerStatus:'unknown', injectable:false, role:'Independent calendar state owner; preserve.'},
  {id:'TE01', ownerStatus:'unknown', injectable:false, role:'Independent editor/dirty/unknown behavior group; preserve.'},
  {id:'TH01', ownerStatus:'unknown', injectable:false, role:'Independent read-only history owner; preserve.'},
];
const UNAVAILABLE_INTEGRATIONS = [
  {id:'TF01', availability:'unavailable', reason:'Exact current accepted source is unavailable; no replacement is synthesized.'},
  {id:'HF-TF', availability:'unavailable', reason:'Exact accepted combined source is unavailable; independent adapters are not that composition.'},
];
function sourceFiles(sourceId) {
  return Object.entries(FILE_PINS[sourceId]).map(([path,sha256]) => ({sourceId,path,sha256}));
}
function fileRefs(sourceId, paths) {
  return paths.map(path => {
    const sha256 = FILE_PINS[sourceId][path];
    if (!sha256) throw new Error('Unpinned logical catalog source path.');
    return {sourceId,path,sha256};
  });
}
function hfFingerprint(variantId) {
  const identity = SOURCE_IDENTITIES[variantId];
  return {
    assemblyMembersSha256:identity.assemblyMembersSha256,
    // Existing HF01 frontend-relative paths and ordering are preserved.
    files:fileRefs(identity.sourceId,[TASKS_VIEW,TASKS_SCREEN,WORKSPACE])
      .map(({path,sha256}) => ({path:path.slice('frontend/'.length),sha256})),
  };
}
// New candidate identities only. Every retained integration01 candidate stays unchanged.
const SOURCE_REGION_FILES = {
  "harbour": [
    {
      "sourceId": "hf-full-presenters01",
      "path": "frontend/src/preview/tasks-hf-full-presentation/presentation.ts",
      "sha256": "01388d873c31e1c2a3388d54fd30f037bdf1358f745af369c97518555b50df59"
    },
    {
      "sourceId": "module-source-regions02",
      "path": "frontend/src/preview/tasks-module-presentation02/source-region-appearance.ts",
      "sha256": "83626c682da7e8b8bdbcfa429b8999cb667f3321a7f9f3b07c5e33846804098c"
    }
  ],
  "fourth": [
    {
      "sourceId": "hf-full-presenters01",
      "path": "frontend/src/preview/tasks-hf-full-presentation/presentation.ts",
      "sha256": "01388d873c31e1c2a3388d54fd30f037bdf1358f745af369c97518555b50df59"
    },
    {
      "sourceId": "module-source-regions02",
      "path": "frontend/src/preview/tasks-module-presentation02/source-region-appearance.ts",
      "sha256": "83626c682da7e8b8bdbcfa429b8999cb667f3321a7f9f3b07c5e33846804098c"
    }
  ],
  "care": [
    {
      "sourceId": "care-presenters01",
      "path": "frontend/src/preview/tasks-care-presentation/CareDateList.tsx",
      "sha256": "750701c8c6d0f2c70f1b74a4624cf0dc272b2075f047fb8b280ed105731b6160"
    },
    {
      "sourceId": "care-presenters01",
      "path": "frontend/src/preview/tasks-care-presentation/CareReadState.tsx",
      "sha256": "79b7b69587d6b2f9d6fe841597afcf23b905e6b3e451b243e1d0fda96abf7cc1"
    },
    {
      "sourceId": "care-presenters01",
      "path": "frontend/src/preview/tasks-care-presentation/CareTaskRowContent.tsx",
      "sha256": "21f3115e4a16caf42ce19729c6d1150fa1e3b9f6eb26f7b21634c84718b88046"
    },
    {
      "sourceId": "care-presenters01",
      "path": "frontend/src/preview/tasks-care-presentation/CareTasksHeader.tsx",
      "sha256": "be898d74230ae5aae9d3ae68fd67b292277a16ee7048279195c55b619c30549b"
    },
    {
      "sourceId": "care-presenters01",
      "path": "frontend/src/preview/tasks-care-presentation/presentation.ts",
      "sha256": "a2f65b3795a9ad9955a0f06d55601a094fa2b5835f72fe39793d0abee9566bb4"
    },
    {
      "sourceId": "care-presenters01",
      "path": "frontend/src/preview/tasks-care-presentation/source-theme.ts",
      "sha256": "1a7a374a71b45845549ac1d14c0909be083c35c4c5cffb759c59786290fba810"
    },
    {
      "sourceId": "care-presenters01",
      "path": "frontend/src/preview/tasks-care-presentation/styles.ts",
      "sha256": "7ff42a577e5ae1fde86ca5ab50f08c7c9943e2f1c94ff6dfbae1014e41468358"
    },
    {
      "sourceId": "module-source-regions02",
      "path": "frontend/src/preview/tasks-module-presentation02/source-region-appearance.ts",
      "sha256": "83626c682da7e8b8bdbcfa429b8999cb667f3321a7f9f3b07c5e33846804098c"
    }
  ],
  "handbook": [
    {
      "sourceId": "handbook-presentation01",
      "path": "frontend/src/preview/tasks-handbook-presentation/HandbookDateList.tsx",
      "sha256": "0b793011e984746dd9d005e9e718b4dd702092956347af560c8f37b4524a366c"
    },
    {
      "sourceId": "handbook-presentation01",
      "path": "frontend/src/preview/tasks-handbook-presentation/HandbookTaskRowContent.tsx",
      "sha256": "3b801597e25e745fbcb3511cc49161195bbedababa3b7187dc29befece064593"
    },
    {
      "sourceId": "handbook-presentation01",
      "path": "frontend/src/preview/tasks-handbook-presentation/HandbookTasksHeader.tsx",
      "sha256": "bce030b8f2f82c0c007ea4272d8ebe82d9abf74ec646c08056be4065b83648b7"
    },
    {
      "sourceId": "handbook-presentation01",
      "path": "frontend/src/preview/tasks-handbook-presentation/presentation.ts",
      "sha256": "6827d59ce9045292ac04587e70739b6df9409c5603bbb46cdc8a6be79f6aac80"
    },
    {
      "sourceId": "handbook-presentation01",
      "path": "frontend/src/preview/tasks-handbook-presentation/source-theme.ts",
      "sha256": "4b5916e8df5156a34d9dee8d767557593cc8824994fcf1e88594514e8ee3f972"
    },
    {
      "sourceId": "handbook-presentation01",
      "path": "frontend/src/preview/tasks-handbook-presentation/styles.ts",
      "sha256": "5148aa86e2678d00543a2d96756dd41674f4d1cc480a0e56b4c586b66300bd90"
    },
    {
      "sourceId": "module-source-regions02",
      "path": "frontend/src/preview/tasks-module-presentation02/source-region-appearance.ts",
      "sha256": "83626c682da7e8b8bdbcfa429b8999cb667f3321a7f9f3b07c5e33846804098c"
    }
  ]
};
function sourceRegionCandidates(variantId, slotId) {
  const identity=SOURCE_IDENTITIES[variantId];
  if (!identity || !['header-actions','date-list'].includes(slotId) || slotId==='header-actions'&&variantId==='handbook') return [];
  const header=slotId==='header-actions', ingredients=SOURCE_REGION_FILES[variantId];
  return [{slotId,variantId,hostVariantId:'harbour',candidateId:header?'header-source-regions02':'date-list-source-regions02',
    coverage:header?'header-source-regions-partial-host':'date-list-source-regions-partial-host',adapterVersion:'module-integration02-v1',
    sourceAvailability:'available',acceptance:'source-reviewed-integration-unverified',prospectiveComposable:true,runtimeAdmission:false,protectedOwner:OWNER,
    appearanceLimit:header?'Source heading and action regions; current guarded host primitives, not full historical wrapping/theme or runtime acceptance.'
      :'Source groups, rows, successful empty/read/paging/load-more; independent filter clear/context and host background/Paper semantics remain; no global theme or runtime acceptance.',
    sourceFingerprint:{assemblyMembersSha256:identity.kind==='restored-assembly'?identity.assemblyMembersSha256:identity.expectedProjectedRowsSha256,
      files:ingredients.map(({path,sha256})=>({path:path.slice('frontend/'.length),sha256}))},
    dependenciesFingerprint:"046a854be320ae0bf472ebfe900f8e7f0c7a7ad6483e8687f1a0a0a34333e871",sourceFiles:ingredients,
    referenceFiles:fileRefs(identity.sourceId,[TASKS_VIEW,ROW,'frontend/src/theme.ts']),
  }];
}

// Source-reviewed ingredients, with this host binding still explicitly unverified.
// These are editable partial candidates, never whole-slot or runtime admission.
function presentationCandidates(variantId, slotId) {
  const identity = SOURCE_IDENTITIES[variantId];
  if (!identity) return [];
  const handbookOnly = slotId === 'header-actions' || slotId === 'date-list';
  if (handbookOnly && variantId !== 'handbook') return [];
  const descriptors = {
    'header-actions':['header-presentation','header-appearance','Handbook title/actions; existing H button semantics for history; no global theme claim.'],
    filters:['filters-presentation','controlled-filters-h-theme','Controlled source regions with H primitive typography, radius and palette; not exact historical theme.'],
    'date-list':['date-list-presentation','date-groups-and-rows','Handbook date groups and row source appearance; host notices, empty states, pagination and load-more remain H.'],
    'calendar-layout':['calendar-presentation','controlled-calendar-layout-h-theme','Source calendar/list placement with H primitives/theme; protected detail surface remains H; actual Care root measurement and runtime acceptance pending.'],
  };
  const descriptor = descriptors[slotId];
  if (!descriptor) return [];
  const paths = slotId === 'header-actions' ? [TASKS_VIEW,TASKS_SCREEN]
    : slotId === 'date-list' ? [TASKS_VIEW,ROW] : slotId === 'filters' ? [TASKS_VIEW,PROJECTION] : [TASKS_VIEW,CALENDAR,PROJECTION];
  const ingredients = sourceFiles(handbookOnly ? 'handbook-presentation01' : 'filter-calendar-presentation01');
  return [{slotId,variantId,hostVariantId:'harbour',candidateId:descriptor[0],coverage:descriptor[1],
    adapterVersion:'module-integration01-v1',sourceAvailability:'available',
    acceptance:'source-reviewed-integration-unverified',prospectiveComposable:true,runtimeAdmission:false,protectedOwner:OWNER,
    appearanceLimit:descriptor[2],
    // The legacy field name is retained by the recipe wire format. For a
    // historical build this is its projected-row manifest hash, not an assembly claim.
    sourceFingerprint:{assemblyMembersSha256:identity.kind === 'restored-assembly' ? identity.assemblyMembersSha256 : identity.expectedProjectedRowsSha256,
      files:[...fileRefs(identity.sourceId,paths).map(({path,sha256})=>({path:path.slice('frontend/'.length),sha256})),
        ...ingredients.map(({path,sha256})=>({path:path.slice('frontend/'.length),sha256}))]},
    dependenciesFingerprint:'c4f03f1c69b6a1bc28538109b4decd863d7a49422851babdb1bc25a19748509f', sourceFiles:ingredients,
    referenceFiles:[...fileRefs(identity.sourceId,[...paths,'frontend/src/theme.ts']),
      ...fileRefs('harbour-h629',['frontend/src/theme.ts','frontend/src/task-view-model.ts'])],
  }];
}
function narrowCandidates(variantId, slotId) {
  if (variantId !== 'harbour' && variantId !== 'fourth') return [];
  const shared = {
    slotId, variantId, hostVariantId:'harbour', sourceAvailability:'available',
    acceptance:'bounded-source-accepted', prospectiveComposable:true,
    runtimeAdmission:false, protectedOwner:OWNER,
  };
  if (slotId === 'header-actions') return [{
    ...shared, candidateId:'header-actions', coverage:'actions-only', adapterVersion:'hf01-v1',
    sourceFingerprint:hfFingerprint(variantId),
    dependenciesFingerprint:'ff4e1776d4892fdce613f5db3aa8369c06c8ca024bfa20244f33a22c85d197d6',
    sourceFiles:sourceFiles('hf01-v1'),
    referenceFiles:[
      ...fileRefs(SOURCE_IDENTITIES[variantId].sourceId,[TASKS_VIEW,TASKS_SCREEN,WORKSPACE]),
      ...fileRefs('harbour-h629',['frontend/src/theme.ts','frontend/src/task-view-model.ts']),
    ],
  }];
  if (slotId === 'date-list') return [{
    ...shared, candidateId:'row-appearance', coverage:'row-appearance',
    adapterVersion:'row-appearance-source01-20261108',
    sourceFingerprint:{
      assemblyMembersSha256:SOURCE_IDENTITIES.harbour.assemblyMembersSha256,
      files:fileRefs('harbour-h629',[TASKS_VIEW,ROW])
        .map(({path,sha256}) => ({path:path.slice('frontend/'.length),sha256})),
    },
    dependenciesFingerprint:ROW_DEPENDENCIES_FINGERPRINT,
    sourceFiles:sourceFiles('row-appearance-source01-20261108'),
    referenceFiles:[
      ...fileRefs('harbour-h629',[TASKS_VIEW,ROW,WORKSPACE,'frontend/src/theme.ts','frontend/src/task-view-model.ts','frontend/src/components/tasks/TaskHistoryView.tsx']),
      ...fileRefs('fourth-f599',[ROW]),
    ],
  }];
  return [];
}
// Exact historical row fragments only; never Original composite membership.
const ORIGINAL_ROW_FRAGMENT = {
  "digest": "f76a151f8b1ef7facd07b8d820d97bcdf81681f29be558b3c3556ce93d084e43",
  "files": [
    {
      "sourceId": "original-row-fragment01",
      "path": "frontend/src/preview/tasks-original-presentation/OriginalTaskRowContent.tsx",
      "sha256": "045ee6305460fe1c3d6c754da88dbfef4da1ccd393591e295de38537fbfc0220"
    },
    {
      "sourceId": "original-row-fragment01",
      "path": "frontend/src/preview/tasks-original-presentation/contracts.ts",
      "sha256": "e719a0781f63f7ff8bca60fac4a412e720c94c1184255d8f4e74b707d8a7096b"
    },
    {
      "sourceId": "original-row-fragment01",
      "path": "frontend/src/preview/tasks-original-presentation/date-list.ts",
      "sha256": "1310a03ffa2a883d1e5a6452a327ecfeaa848861344045e0ee073e8ac4dbb01b"
    },
    {
      "sourceId": "original-row-fragment01",
      "path": "frontend/src/preview/tasks-original-presentation/styles.ts",
      "sha256": "65343352e1fd211b423b59cf87e4f6c0dda6c79fb0a2cca0fdeaf6719fec3a48"
    },
    {
      "sourceId": "original-row-fragment01",
      "path": "frontend/src/preview/tasks-original-presentation/source-theme.ts",
      "sha256": "89040def89e675e67a1c111cc765e2198ba1b477b84de9393acfb983e0d60c7a"
    }
  ],
  "references": [
    {
      "sourceId": "original-historical-fragments01",
      "path": "frontend/src/theme.ts",
      "sha256": "747b825d2c49eb72b2d73c5919c0aa6217b0750d3651ddea1d053337d8a088a2"
    },
    {
      "sourceId": "original-historical-fragments01",
      "path": "frontend/src/components/tasks/TaskListRow.tsx",
      "sha256": "f17f83115786cbf11bfb238da0279ba96c95b6359c3bb2c9f56e3eaca9f0bc69"
    },
    {
      "sourceId": "original-historical-fragments01",
      "path": "frontend/src/components/AppStatusBadge.tsx",
      "sha256": "23f5819f4ae7ef7f263c6700ca362ec98a4be33d6d26e484d59f859d2713fb82"
    }
  ]
};
function originalRowFragmentCandidates(variantId, slotId) {
  if (variantId !== 'original' || slotId !== 'date-list') return [];
  return [{slotId, variantId, hostVariantId:'harbour', candidateId:'original-row-fragment01',
    coverage:'historical-row-fragment', adapterVersion:'original-row-fragment01-v1',
    sourceAvailability:'available', acceptance:'source-reviewed-integration-unverified',
    prospectiveComposable:true, runtimeAdmission:false, protectedOwner:OWNER,
    appearanceLimit:'Verified historical row fragments only; existing H toggle/guards, groups, read/empty/paging remain. Composite identity and global theme unverified; comparison handoff is candidate text only, requiring explicit restore and apply.',
    // Legacy wire-field: digest of this fragment manifest, NOT assembly membership.
    sourceFingerprint:{assemblyMembersSha256:ORIGINAL_ROW_FRAGMENT.digest,
      files:ORIGINAL_ROW_FRAGMENT.files.map(({path,sha256})=>({path:path.slice('frontend/'.length),sha256}))},
    dependenciesFingerprint:ORIGINAL_ROW_FRAGMENT.digest,
    sourceFiles:ORIGINAL_ROW_FRAGMENT.files, referenceFiles:ORIGINAL_ROW_FRAGMENT.references,
  }];
}
// Selected historical action fragments only; no complete header or Original identity.
const ORIGINAL_ACTIONS_FRAGMENT = {
  "digest": "33a949586d2e602c68f1269c7825860e6d8c48a5c8d207c695b01e610c30c60c",
  "files": [
    {
      "sourceId": "original-actions-fragment01",
      "path": "frontend/src/preview/tasks-original-presentation/action-appearance.ts",
      "sha256": "050d1ecc7e0bc814f672727c13b6c57a72ecbc0b92319a7ce1a4aab7477786ee"
    },
    {
      "sourceId": "original-actions-fragment01",
      "path": "frontend/src/preview/tasks-original-presentation/contracts.ts",
      "sha256": "e719a0781f63f7ff8bca60fac4a412e720c94c1184255d8f4e74b707d8a7096b"
    },
    {
      "sourceId": "original-actions-fragment01",
      "path": "frontend/src/preview/tasks-original-presentation/header.ts",
      "sha256": "934de26fe77b0ae543694510c0507b61bca75c5fcd13fcc873dac444ee3dcd0a"
    },
    {
      "sourceId": "original-actions-fragment01",
      "path": "frontend/src/preview/tasks-original-presentation/source-theme.ts",
      "sha256": "89040def89e675e67a1c111cc765e2198ba1b477b84de9393acfb983e0d60c7a"
    },
    {
      "sourceId": "original-actions-fragment01",
      "path": "frontend/src/preview/tasks-original-presentation/styles.ts",
      "sha256": "65343352e1fd211b423b59cf87e4f6c0dda6c79fb0a2cca0fdeaf6719fec3a48"
    }
  ],
  "references": [
    {
      "sourceId": "original-historical-fragments01",
      "path": "frontend/src/components/tasks/TasksView.tsx",
      "sha256": "08096e0f7d128be39eddeddc0549a12867b1d6a787b5a610172239360debe622"
    },
    {
      "sourceId": "original-historical-fragments01",
      "path": "frontend/src/components/ui.tsx",
      "sha256": "85840c349cb443b84438b9c602b0d12d05f5eecdcdeb6e47af30e77c63424563"
    },
    {
      "sourceId": "original-historical-fragments01",
      "path": "frontend/src/theme.ts",
      "sha256": "747b825d2c49eb72b2d73c5919c0aa6217b0750d3651ddea1d053337d8a088a2"
    }
  ]
};
function originalActionsFragmentCandidates(variantId, slotId) {
  if (variantId !== 'original' || slotId !== 'header-actions') return [];
  return [{slotId, variantId, hostVariantId:'harbour', candidateId:'original-actions-fragment01',
    coverage:'historical-actions-fragment', adapterVersion:'original-actions-fragment01-v2',
    sourceAvailability:'available', acceptance:'source-reviewed-integration-unverified',
    prospectiveComposable:true, runtimeAdmission:false, protectedOwner:OWNER,
    appearanceLimit:'Selected historical action buttons and disclosure only; existing HF01 owner with matching Fourth action arrangement, H heading and toolbar geometry remain. Composite identity and global theme unverified; comparison handoff is candidate text only, requiring explicit restore and apply.',
    // Legacy wire-field: fragment manifest digest, NOT assembly membership.
    sourceFingerprint:{assemblyMembersSha256:ORIGINAL_ACTIONS_FRAGMENT.digest,
      files:ORIGINAL_ACTIONS_FRAGMENT.files.map(({path,sha256})=>({path:path.slice('frontend/'.length),sha256}))},
    dependenciesFingerprint:ORIGINAL_ACTIONS_FRAGMENT.digest,
    sourceFiles:ORIGINAL_ACTIONS_FRAGMENT.files, referenceFiles:ORIGINAL_ACTIONS_FRAGMENT.references,
  }];
}
function makeSlot(variantId, slotId) {
  const identity = SOURCE_IDENTITIES[variantId];
  const paths = {
    'header-actions':[TASKS_VIEW,TASKS_SCREEN,WORKSPACE],
    filters:[TASKS_VIEW,TASKS_SCREEN,PROJECTION],
    'date-list':[TASKS_VIEW,ROW,PROJECTION,'frontend/src/task-view-model.ts'],
    'calendar-layout':[TASKS_VIEW,CALENDAR,PROJECTION],
  }[slotId];
  const state = {
    'header-actions':['scope','access','operation','disclosure'],
    filters:['tab','filter','query','day','page','window'],
    'date-list':['selection','route','page','scroll','focus-return'],
    'calendar-layout':['selectedDay','month','calendar-disclosure','responsive-layout'],
  }[slotId];
  return {
    slotId, label:SLOT_LABELS[slotId], sourceAvailability:identity ? 'available' : 'unavailable',
    sourceFiles:identity ? fileRefs(identity.sourceId,paths) : [],
    behaviorOwnership:{
      authority:identity ? 'source-owned' : 'unavailable', injectable:false, state,
      ownerComponents:identity ? [TASKS_VIEW,TASKS_SCREEN,WORKSPACE] : [],
      description:DIFFERENCES[variantId].state,
    },
    sourceDifference:slotId === 'header-actions' ? DIFFERENCES[variantId].header
      : slotId === 'calendar-layout' ? DIFFERENCES[variantId].layout : DIFFERENCES[variantId].state,
    wholeSlotComposable:false, acceptance:'not-accepted', runtimeAdmission:false,
    narrowCandidates:[...originalActionsFragmentCandidates(variantId,slotId),...originalRowFragmentCandidates(variantId,slotId),...narrowCandidates(variantId,slotId),...presentationCandidates(variantId,slotId),...sourceRegionCandidates(variantId,slotId)],
  };
}
function makeVariant(variantId) {
  const identity = SOURCE_IDENTITIES[variantId] ?? null;
  const assembly = identity?.kind === 'restored-assembly';
  return {
    variantId, label:LABELS[variantId], ownerContract:OWNER,
    source:{
      availability:identity ? (assembly ? 'available' : 'partial') : 'unavailable',
      identity, fingerprint:assembly ? hfFingerprint(variantId) : null,
      historicalPointer:variantId === 'original' ? ORIGINAL_HISTORICAL_POINTER : null,
      files:identity ? sourceFiles(identity.sourceId) : [],
      missingInputs:identity && !assembly ? HISTORICAL_MISSING_INPUTS : [],
      assemblyMembersVerified:assembly, fullTrackedBytesVerified:false,
      importClosureVerified:false, claimsLatest:false,
    },
    globalTheme:{requiredVariantId:'original', sourceVariantId:identity ? variantId : null, acceptance:'not-accepted', runtimeAdmission:false},
    slots:TASK_SLOT_IDS.map(slotId => makeSlot(variantId,slotId)),
    protectedBehaviorGroup:{
      members:['form','detail','dirty','saving','unknown','conflict','recovery'],
      splittable:false, selectable:false, sourceAvailability:identity ? 'available' : 'unavailable',
      sourceFiles:identity ? fileRefs(identity.sourceId,[
        'frontend/src/components/tasks/TaskForm.tsx','frontend/src/components/tasks/TaskDetail.tsx',
        'frontend/src/components/tasks/task-form.ts','frontend/src/components/FormDialog.tsx',
        'frontend/src/preview/PreviewNavigationGuard.tsx','frontend/src/production/ProductionProvider.tsx',
        WORKSPACE,'frontend/src/task-view-model.ts',
      ]) : [],
    },
    existingLanes:EXISTING_LANES, unavailableIntegrations:UNAVAILABLE_INTEGRATIONS,
    runtimeAdmission:false, firstPhaseAccepted:false,
  };
}
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
/** Immutable metadata, not an executable product registry or admission token. */
export const TASK_VARIANTS = deepFreeze(VARIANT_IDS.map(makeVariant));
export function getTaskVariant(variantId) {
  if (typeof variantId !== 'string') return null;
  return TASK_VARIANTS.find(row => row.variantId === variantId) ?? null;
}
export function getTaskSlot(variantId, slotId) {
  if (typeof slotId !== 'string') return null;
  return getTaskVariant(variantId)?.slots.find(slot => slot.slotId === slotId) ?? null;
}
export function getTaskNarrowCandidate(variantId, slotId, candidateId) {
  if (typeof candidateId !== 'string') return null;
  return getTaskSlot(variantId,slotId)?.narrowCandidates.find(candidate => candidate.candidateId === candidateId) ?? null;
}
export function checkTaskSlotCapability(variantId, slotId, purpose) {
  const slot = getTaskSlot(variantId,slotId);
  if (!slot || (purpose !== 'compare' && purpose !== 'compose'))
    return {sourceAvailable:false, prospectiveComposable:false, runtimeAdmission:false, reasons:['unknown-variant-slot-or-purpose']};
  const sourceAvailable = slot.sourceAvailability === 'available';
  const reasons = !sourceAvailable ? ['source-unavailable'] : purpose === 'compare'
    ? ['source-comparison-only','runtime-not-admitted']
    : [slot.narrowCandidates.length ? 'partial-adapter-only' : 'whole-slot-adapter-unavailable', 'original-theme-unavailable', 'runtime-not-admitted'];
  return {sourceAvailable, prospectiveComposable:false, runtimeAdmission:false, reasons};
}
// Exact-version validation, not arbitrary schema acceptance. Inspect descriptors
// before values so accessors cannot run. Unknown hashes cannot create authority.
function sameData(value, expected, depth = 0) {
  if (depth > 40) return false;
  if (expected === null || typeof expected !== 'object') return value === expected;
  if (value === null || typeof value !== 'object') return false;
  const array = Array.isArray(expected);
  if (Array.isArray(value) !== array) return false;
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value), expectedKeys = Reflect.ownKeys(expected);
  if (keys.length !== expectedKeys.length || keys.some(key => typeof key !== 'string' || !expectedKeys.includes(key))) return false;
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value,key);
    if (!descriptor || !Object.hasOwn(descriptor,'value') || !sameData(descriptor.value,expected[key],depth+1)) return false;
  }
  return true;
}
/** Checks current metadata only; never checks or grants runtime admission. */
export function validateTaskVariantCatalog(value) {
  try { return sameData(value,TASK_VARIANTS); } catch { return false; }
}
