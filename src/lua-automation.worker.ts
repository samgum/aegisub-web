import { lua, lauxlib, lualib, to_luastring } from "fengari";

const scope = self as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage(message: unknown): void };

function luaLiteral(value: unknown): string {
  if (value == null) return "nil";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "0";
  if (typeof value === "string") return JSON.stringify(value).replace(/\u2028|\u2029/g, " ");
  if (Array.isArray(value)) return `{${value.map(luaLiteral).join(",")}}`;
  if (typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).map(([key, item]) => `[${luaLiteral(key)}]=${luaLiteral(item)}`).join(",")}}`;
  return "nil";
}

const BOOTSTRAP = String.raw`
io = nil
if os then os.execute = nil; os.remove = nil; os.rename = nil; os.tmpname = nil end
if package then package.loadlib = nil; package.cpath = "" end
local __macros = {}
aegisub = {
  register_macro = function(name, description, run, validate) table.insert(__macros, {name=name, description=description, run=run, validate=validate}) end,
  register_filter = function(name, description, priority, run, config) table.insert(__macros, {name=name, description=description, run=run, validate=config}) end,
  set_undo_point = function() end,
  cancel = function() error("cancelled") end,
  log = function(...) end,
  debug = { out = function(...) end },
  progress = { set=function() end, task=function() end, title=function() end, is_cancelled=function() return false end },
  decode_path = function(path) return path end,
  text_extents = function(style, text) return #tostring(text) * (tonumber(style.fontsize) or 20) * .55, tonumber(style.fontsize) or 20, 0, 0 end,
  frame_from_ms = function(ms) return math.floor(ms / 1000 * 23.976 + .5) end,
  ms_from_frame = function(frame) return math.floor(frame / 23.976 * 1000 + .5) end,
}

local function json_escape(value)
  return value:gsub('\\','\\\\'):gsub('"','\\"'):gsub('\b','\\b'):gsub('\f','\\f'):gsub('\n','\\n'):gsub('\r','\\r'):gsub('\t','\\t')
end
local function is_array(value)
  local max, count = 0, 0
  for key in pairs(value) do if type(key) ~= 'number' or key < 1 or key % 1 ~= 0 then return false end max=math.max(max,key) count=count+1 end
  return max == count
end
local function json_encode(value, seen)
  local kind = type(value)
  if kind == 'nil' then return 'null' end
  if kind == 'boolean' or kind == 'number' then return tostring(value) end
  if kind == 'string' then return '"' .. json_escape(value) .. '"' end
  if kind ~= 'table' then return 'null' end
  seen = seen or {}; if seen[value] then error('cyclic table') end; seen[value]=true
  local parts = {}
  if is_array(value) then for index=1,#value do parts[#parts+1]=json_encode(value[index],seen) end
  else for key,item in pairs(value) do if type(key)=='string' then parts[#parts+1]='"'..json_escape(key)..'":'..json_encode(item,seen) end end end
  seen[value]=nil
  return (is_array(value) and '[' or '{') .. table.concat(parts, ',') .. (is_array(value) and ']' or '}')
end
`;

scope.onmessage = (event) => {
  const { code, entries, selection, active } = event.data as { code: string; entries: unknown[]; selection: number[]; active: number };
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const chunk = `${BOOTSTRAP}
local __rawsubs = ${luaLiteral(entries)}
local __methods = {}
local __subs
__methods.append = function(...) local args={...}; local first=(args[1]==__subs) and 2 or 1; for i=first,#args do table.insert(__rawsubs,args[i]) end end
__methods.insert = function(a,b,c) local index,line;if a==__subs then index,line=b,c else index,line=a,b end;table.insert(__rawsubs,index,line) end
__methods.delete = function(...) local args={...};local first=(args[1]==__subs) and 2 or 1;local ids={};for i=first,#args do if type(args[i])=='table' then for _,v in ipairs(args[i]) do ids[#ids+1]=v end else ids[#ids+1]=args[i] end end;table.sort(ids,function(a,b)return a>b end);for _,v in ipairs(ids) do table.remove(__rawsubs,v) end end
__methods.deleterange = function(a,b,c) local first,last;if a==__subs then first,last=b,c else first,last=a,b end;for i=last,first,-1 do table.remove(__rawsubs,i) end end
__subs=setmetatable({}, {__len=function() return #__rawsubs end,__index=function(_,key) if type(key)=='number' then return __rawsubs[key] else return __methods[key] end end,__newindex=function(_,key,value) if type(key)=='number' then __rawsubs[key]=value else rawset(__methods,key,value) end end})
${code}
if #__macros == 0 then error('No aegisub.register_macro or register_filter call found') end
local __selection=${luaLiteral(selection)}
local __macro=__macros[1]
if not __macro.validate or __macro.validate(__subs,__selection,${active}) ~= false then __macro.run(__subs,__selection,${active}) end
return json_encode(__rawsubs)`;
  try {
    const status = lauxlib.luaL_loadstring(state, to_luastring(chunk));
    if (status !== lua.LUA_OK) throw new Error(lua.lua_tojsstring(state, -1));
    const call = lua.lua_pcall(state, 0, 1, 0);
    if (call !== lua.LUA_OK) throw new Error(lua.lua_tojsstring(state, -1));
    scope.postMessage({ ok: true, entries: JSON.parse(lua.lua_tojsstring(state, -1)) });
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    lua.lua_close(state);
  }
};
