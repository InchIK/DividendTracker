/**
 * Scriptable iOS App — Ambient Type Declarations.
 *
 * Declares the global APIs provided by the Scriptable runtime
 * (https://docs.scriptable.app/) so the widget TypeScript source compiles
 * under the project's strict tsconfig without bundling a separate @types
 * package. This file is picked up by `tsconfig.widget.json` which includes
 * every `.ts` file under `widget-src/`.
 *
 * Only the APIs actually used by the widget are declared. Extend this file
 * when you need additional Scriptable globals.
 */

// ---------------------------------------------------------------------------
// WidgetKit widget families (provided by Scriptable via `config.widgetFamily`).
// ---------------------------------------------------------------------------

declare type WidgetFamily =
  | 'accessoryRectangular' // Lock Screen rectangular slot (iOS 16+)
  | 'accessoryInline'      // Lock Screen inline slot (iOS 16+)
  | 'accessoryCircular'    // Lock Screen circular slot (iOS 16+)
  | 'small'                // Home Screen 2×2
  | 'medium'               // Home Screen 4×2
  | 'large';               // Home Screen 4×4

// ---------------------------------------------------------------------------
// ListWidget — the central widget builder object returned by `new ListWidget()`.
// Docs: https://docs.scriptable.app/#listwidget
// ---------------------------------------------------------------------------

declare interface WidgetText {
  text: string;
  font: Font;
  textColor?: Color;
  lineLimit: number;
  minimumScaleFactor: number;
  opacity: number;
  leftAlignText(): void;
  centerAlignText(): void;
  rightAlignText(): void;
}

declare interface WidgetStack {
  size: Size;
  backgroundColor?: Color;
  backgroundGradient?: LinearGradient;
  cornerRadius: number;
  borderWidth: number;
  borderColor?: Color;
  url?: string;
  layoutHorizontally(): void;
  layoutVertically(): void;
  topAlignContent(): void;
  centerAlignContent(): void;
  bottomAlignContent(): void;
  setPadding(top: number, left: number, bottom: number, right: number): void;
  addText(text: string): WidgetText;
  addDate(date: Date): WidgetDate;
  addImage(image: Image): WidgetImage;
  addSpacer(spacing?: number): void;
  addStack(): WidgetStack;
}

declare class ListWidget {
  constructor();

  // Layout
  setPadding(top: number, left: number, bottom: number, right: number): void;
  setSpacing(spacing: number): void;
  backgroundColor: Color;
  backgroundGradient: LinearGradient;
  /** Adaptive Lock Screen accessory background. */
  addAccessoryWidgetBackground: boolean;
  /** Earliest date at which iOS may refresh this widget. */
  refreshAfterDate: Date | null;

  // Content
  addText(text: string): WidgetText;
  addStack(): WidgetStack;
  addDate(date: Date): WidgetDate;
  addImage(image: Image): WidgetImage;
  addSpacer(spacing?: number): void;
  url: string;

  // Preview APIs (used by the setup menu's preview actions).
  presentMedium(): Promise<void>;
  presentLarge(): Promise<void>;
  presentSmall(): Promise<void>;
  presentAccessoryRectangular(): Promise<void>;
  presentAccessoryInline(): Promise<void>;
}

declare interface WidgetDate {
  date: Date;
  font: Font;
  textColor?: Color;
}

declare interface WidgetImage {
  image: Image;
  imageSize: Size;
  imageOpacity: number;
  cornerRadius: number;
  resizable: boolean;
  tintColor?: Color;
}

declare interface Size {
  width: number;
  height: number;
}

declare interface Image {
  readonly size: Size;
}

// ---------------------------------------------------------------------------
// Font — system & named fonts. Docs: https://docs.scriptable.app/#font
// ---------------------------------------------------------------------------

declare class Font {
  static regularSystemFont(size: number): Font;
  static mediumSystemFont(size: number): Font;
  static semiboldSystemFont(size: number): Font;
  static boldSystemFont(size: number): Font;
  static heavySystemFont(size: number): Font;
  static blackSystemFont(size: number): Font;
  static monospacedSystemFont(size: number, weight?: number): Font;
  static italicSystemFont(size: number): Font;
  constructor(name: string, size: number);
  fontName: string;
  pointSize: number;
}

// ---------------------------------------------------------------------------
// Color — picker helpers. Docs: https://docs.scriptable.app/#color
// ---------------------------------------------------------------------------

declare class Color {
  static black(): Color;
  static darkGray(): Color;
  static gray(): Color;
  static lightGray(): Color;
  static white(): Color;
  static red(): Color;
  static green(): Color;
  static blue(): Color;
  static dynamic(light: Color, dark: Color): Color;
  static transparent(): Color;
  constructor(hex: string, alpha?: number);
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

// ---------------------------------------------------------------------------
// Keychain — secure storage. Docs: https://docs.scriptable.app/#keychain
// ---------------------------------------------------------------------------

declare class Keychain {
  static get(key: string): string | undefined;
  static set(key: string, value: string): void;
  static remove(key: string): void;
  static contains(key: string): boolean;
  static allKeys(): string[];
}

// ---------------------------------------------------------------------------
// FileManager — local + iCloud. Docs: https://docs.scriptable.app/#filemanager
// ---------------------------------------------------------------------------

declare class FileManager {
  static local(): FileManager;
  static iCloud(): FileManager;
  documentsDirectory(): string;
  cacheDirectory(): string;
  libraryDirectory(): string;
  temporaryDirectory(): string;
  joinPath(rootPath: string, subPath: string): string;
  fileExists(path: string): boolean;
  directoryExists(path: string): boolean;
  createDirectory(path: string, intermediateDirectories?: boolean): void;
  readString(path: string): string;
  read(path: string): unknown;
  readJSON(path: string): unknown;
  write(path: string, content: unknown): void;
  writeString(path: string, content: string): void;
  remove(path: string): void;
  moveTo(srcPath: string, dstPath: string): void;
  copyTo(srcPath: string, dstPath: string): void;
  listDirectory(path: string): string[];
  modificationDate(path: string): Date;
}

// ---------------------------------------------------------------------------
// Alert — modal dialog (used by setup menu). Docs: https://docs.scriptable.app/#alert
// ---------------------------------------------------------------------------

declare class Alert {
  title: string;
  message: string;
  addAction(title: string): void;
  addCancelAction(title: string): void;
  addTextField(placeholder?: string, text?: string): void;
  addSecureTextField(placeholder?: string, text?: string): void;
  textFieldValue(index: number): string;
  present(): Promise<number>;
}

declare class Point {
  constructor(x: number, y: number);
  x: number;
  y: number;
}

declare class LinearGradient {
  colors: Color[];
  locations: number[];
  startPoint: Point;
  endPoint: Point;
}

// ---------------------------------------------------------------------------
// Script — runtime control APIs. Docs: https://docs.scriptable.app/#script
// ---------------------------------------------------------------------------

declare interface ScriptStatic {
  name(): string;
  path(): string;
  setWidget(widget: ListWidget): void;
  complete(): void;
  setRefreshInterval?(seconds: number): void;
  // Some Scriptable versions expose refreshAfterDate(date) on Script directly.
  setWidgetBackground?(mode: string): void;
}

declare const Script: ScriptStatic;

// ---------------------------------------------------------------------------
// Device — platform info. Docs: https://docs.scriptable.app/#device
// ---------------------------------------------------------------------------

declare interface DeviceStatic {
  isPad(): boolean;
  isWatch(): boolean;
  version(): string;
  systemVersion(): string;
  model(): string;
}

declare const Device: DeviceStatic;

// ---------------------------------------------------------------------------
// Console / log — Scriptable's global log function (also via console).
// ---------------------------------------------------------------------------

/** Write message to the script's log output (also visible in the in-app console). */
declare function log(message: string): void;

// ---------------------------------------------------------------------------
// Widget run args — `args` is ambient-set by Scriptable at script start.
// ---------------------------------------------------------------------------

declare interface WidgetRunArgs {
  widgetParameter?: string;
  widgetFamily?: WidgetFamily;
  size?: { width: number; height: number };
}

declare const args: WidgetRunArgs;

/** Official Scriptable execution context and widget-family information. */
declare const config: {
  runsInApp: boolean;
  runsInWidget: boolean;
  runsInAccessoryWidget: boolean;
  widgetFamily: WidgetFamily | null;
};

// ---------------------------------------------------------------------------
// Persistence — Application-level global state.
// ---------------------------------------------------------------------------

declare interface PersistenceGetterSetter {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  contains(key: string): boolean;
  remove(key: string): void;
  keys(): string[];
}

declare const Persistence: PersistenceGetterSetter;

// ---------------------------------------------------------------------------
// Scriptable native HTTP Request.
// ---------------------------------------------------------------------------

declare class Request {
  constructor(url: string);
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutInterval: number;
  response: {
    url?: string;
    statusCode: number;
    mimeType?: string;
    textEncodingName?: string;
    headers?: Record<string, string>;
  } | null;
  load(): Promise<unknown>;
  loadString(): Promise<string>;
  loadJSON(): Promise<unknown>;
}
