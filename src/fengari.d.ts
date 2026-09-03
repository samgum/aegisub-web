declare module "fengari" {
  export const lua: any;
  export const lauxlib: any;
  export const lualib: any;
  export function to_luastring(value: string): Uint8Array;
}
