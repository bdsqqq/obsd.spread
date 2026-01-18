export class Plugin {
  addCommand() {}
  addSettingTab() {}
  registerEvent() {}
  registerBasesView() {}
  loadData() {
    return Promise.resolve(null);
  }
  saveData() {
    return Promise.resolve();
  }
}

export class BasesView {
  app = {
    vault: { read: async () => "" },
    workspace: { openLinkText: async () => {} },
  };
  data: unknown = null;
  config: unknown = null;
  constructor(_controller: unknown) {}
}

export class TFile {
  path = "";
  basename = "";
  extension = "";
}

export type QueryController = unknown;
export type ViewOption = unknown;
