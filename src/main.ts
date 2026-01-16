import { Plugin } from "obsidian";
import { SpreadView, SPREAD_VIEW_TYPE } from "./spread-view";

export default class SpreadPlugin extends Plugin {
  async onload() {
    this.registerBasesView(SPREAD_VIEW_TYPE, {
      name: "Spread",
      icon: "file-text",
      factory: (controller, containerEl) => new SpreadView(controller, containerEl),
      options: () => SpreadView.getViewOptions(),
    });
  }

  onunload() {}
}
