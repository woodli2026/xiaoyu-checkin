// miniprogram/types/globals.d.ts —— 小程序运行时全局的最小类型声明
//
// 用途：让带 `// @ts-check` 的前端模块能引用 wx / getApp 等全局而不报「未定义」。
// 仅服务于编辑器（VS Code 的 JS 类型检查 / 智能提示），**不参与打包、不进 CI**
// （项目零依赖，不装 tsc）。这些全局一律声明为 any：目标是把「未声明全局」的
// 噪音消掉，而非在此做严格类型建模——需要严格类型的模块应自带 JSDoc。
//
// 说明：字符串/数组等标准全局（Date / JSON / setTimeout …）由 TS 内置 lib 提供，
// 此处不重复声明，避免与 lib.es20xx 冲突。

declare const wx: any;
declare const App: any;
declare const Page: any;
declare const Component: any;
declare const Behavior: any;
declare function getApp<T = any>(): any;
declare function getCurrentPages(): any[];
