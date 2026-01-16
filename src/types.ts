export interface SpreadSettings {
  previewLines: number;
  showFileName: boolean;
  stripFrontmatter: boolean;
  monoFont: boolean;
}

export const DEFAULT_SETTINGS: SpreadSettings = {
  previewLines: 5,
  showFileName: true,
  stripFrontmatter: true,
  monoFont: false,
};
