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
local __meta = __lua_meta or {resX=1920, resY=1080, fps=23.976, keyframes={}, active=1}
aegisub = {
  register_macro = function(name, description, run, validate) table.insert(__macros, {name=name, description=description, run=run, validate=validate}) end,
  register_filter = function(name, description, priority, run, config) table.insert(__macros, {name=name, description=description, run=run, validate=config}) end,
  set_undo_point = function() end,
  cancel = function() error("cancelled") end,
  gettext = function(text) return text end,
  log = function(...) end,
  debug = { out = function(...) end },
  progress = { set=function() end, task=function() end, title=function() end, is_cancelled=function() return false end },
  decode_path = function(path) return path end,
  text_extents = function(style, text)
    local fs = tonumber(type(style)=="table" and style.fontsize) or 20
    local scx = (tonumber(type(style)=="table" and style.scale_x) or 100) / 100
    return #tostring(text) * fs * .55 * scx, fs, 0, 0
  end,
  frame_from_ms = function(ms) return math.floor((ms or 0) / 1000 * (__meta.fps or 23.976) + .5) end,
  ms_from_frame = function(frame) return math.floor((frame or 0) / (__meta.fps or 23.976) * 1000 + .5) end,
  video_size = function()
    local x, y = __meta.resX or 1920, __meta.resY or 1080
    return x, y, x / math.max(1, y), 0
  end,
  keyframes = function() return __meta.keyframes or {} end,
  project_properties = function()
    return {
      automation_scripts = "", export_filters = "", export_encoding = "utf-8",
      audio_file = "", video_file = "", timecodes_file = "", keyframes_file = "",
      video_position = 0, active_line = __meta.active or 1
    }
  end,
  dialog = {
    display = function(config, buttons)
      local res = {}
      if type(config) == "table" then
        for _, item in ipairs(config) do
          if type(item) == "table" and item.name ~= nil then
            res[item.name] = item.value ~= nil and item.value or (item.text or "")
          end
        end
      end
      local pressed = (type(buttons) == "table" and buttons[1]) or true
      return pressed, res
    end
  }
}

package.preload["clipboard"] = function()
  local buf = ""
  return { get = function() return buf end, set = function(v) buf = tostring(v or ""); return true end }
end

package.preload["unicode"] = function()
  local unicode = {}
  function unicode.len(s)
    local ok, n = pcall(utf8.len, tostring(s or ""))
    return (ok and n) or #tostring(s or "")
  end
  function unicode.charwidth(s)
    if not s or s == "" then return 0 end
    local b = string.byte(s, 1)
    if b < 0x80 then return 1 end
    if b < 0xE0 then return 2 end
    if b < 0xF0 then return 3 end
    return 4
  end
  function unicode.chars(s)
    s = tostring(s or "")
    local i = 1
    return function()
      if i > #s then return nil end
      local w = unicode.charwidth(s:sub(i, i))
      local ch = s:sub(i, math.min(#s, i + w - 1))
      i = i + w
      return ch
    end
  end
  function unicode.to_upper_case(s) return string.upper(tostring(s or "")) end
  function unicode.to_lower_case(s) return string.lower(tostring(s or "")) end
  return unicode
end

package.preload["utils"] = function()
  local utils = {}
  function utils.copy_table(t)
    if type(t) ~= "table" then return t end
    local out = {}; for k, v in pairs(t) do out[k] = v end; return out
  end
  function utils.deep_copy(t)
    if type(t) ~= "table" then return t end
    local out = {}; for k, v in pairs(t) do out[utils.deep_copy(k)] = utils.deep_copy(v) end; return out
  end
  function utils.table_length(t) local n = 0; for _ in pairs(t) do n = n + 1 end; return n end
  function utils.clamp(val, minv, maxv) return math.max(minv, math.min(maxv, val)) end
  function utils.interpolate(t, a, b) return a + (b - a) * t end
  function utils.ass_color(r, g, b) return string.format("&H%02X%02X%02X&", utils.clamp(math.floor(b+.5),0,255), utils.clamp(math.floor(g+.5),0,255), utils.clamp(math.floor(r+.5),0,255)) end
  function utils.ass_alpha(a) return string.format("&H%02X&", utils.clamp(math.floor(a+.5),0,255)) end
  function utils.ass_style_color(r, g, b, a) return string.format("&H%02X%02X%02X%02X", utils.clamp(math.floor(a+.5),0,255), utils.clamp(math.floor(b+.5),0,255), utils.clamp(math.floor(g+.5),0,255), utils.clamp(math.floor(r+.5),0,255)) end
  function utils.extract_color(s)
    local hex = tostring(s or ""):match("&[Hh]([0-9A-Fa-f]+)&?") or "000000"
    while #hex < 8 do hex = "0" .. hex end
    local a = tonumber(hex:sub(1,2), 16) or 0
    local b = tonumber(hex:sub(3,4), 16) or 0
    local g = tonumber(hex:sub(5,6), 16) or 0
    local r = tonumber(hex:sub(7,8), 16) or 0
    return r, g, b, a
  end
  function utils.trim(s) return (tostring(s or ""):gsub("^%s*(.-)%s*$", "%1")) end
  return utils
end

package.preload["karaskel"] = function()
  local k = {}
  function k.collect_head(subs, generate_furigana)
    local meta = { res_x = __meta.resX or 1920, res_y = __meta.resY or 1080, video_x_correct_factor = 1 }
    local styles = { n = 0 }
    for i = 1, #subs do
      local l = subs[i]
      if l.class == "style" then
        styles[l.name] = l
        styles.n = styles.n + 1
        table.insert(styles, l)
      end
    end
    return meta, styles
  end
  function k.preproc_line_text(meta, styles, line)
    line.text_stripped = tostring(line.text or ""):gsub("{[^}]*}", "")
    line.kara = {}; line.furi = {}
  end
  function k.preproc_line_size(meta, styles, line)
    local st = styles[line.style] or styles[1] or { fontsize = 40, scale_x = 100 }
    local w, h = aegisub.text_extents(st, line.text_stripped or "")
    line.styleref = st; line.width = w; line.height = h
  end
  function k.preproc_line_pos(meta, styles, line)
    line.x = (meta.res_x or 1920) / 2
    line.y = (meta.res_y or 1080) - 30
    line.left = line.x - (line.width or 0) / 2
    line.right = line.x + (line.width or 0) / 2
  end
  function k.preproc_line(meta, styles, line)
    k.preproc_line_text(meta, styles, line)
    k.preproc_line_size(meta, styles, line)
    k.preproc_line_pos(meta, styles, line)
  end
  return k
end

package.preload["re"] = function()
  local re = {}
  function re.compile(pat)
    return {
      find = function(_, str, init) return string.find(str, pat, init or 1) end,
      sub = function(_, str, repl, maxn) local s = string.gsub(str, pat, repl, maxn); return s end,
      match = function(_, str) local a,b = string.find(str, pat); if not a then return nil end return {{ str=str:sub(a,b), first=a, last=b }} end,
      gsplit = function(_, str, skip_empty)
        local list = {}
        local start = 1
        while start <= #str do
          local a, b = string.find(str, pat, start)
          if not a then table.insert(list, str:sub(start)); break end
          local piece = str:sub(start, a - 1)
          if not skip_empty or piece ~= "" then table.insert(list, piece) end
          start = math.max(b + 1, start + 1)
        end
        local idx = 0
        return function() idx = idx + 1; return list[idx] end
      end
    }
  end
  function re.find(str, pat, init) return re.compile(pat):find(str, init) end
  function re.sub(str, pat, repl, maxn) return re.compile(pat):sub(str, repl, maxn) end
  function re.match(str, pat) return re.compile(pat):match(str) end
  function re.gsplit(str, pat, skip_empty) return re.compile(pat):gsplit(str, skip_empty) end
  return re
end

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
  const { code, entries, selection, active, meta } = event.data as {
    code: string; entries: unknown[]; selection: number[]; active: number;
    meta?: { resX?: number; resY?: number; fps?: number; keyframes?: number[] };
  };
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const chunk = `local __lua_meta = ${luaLiteral({ ...(meta ?? {}), active })}
${BOOTSTRAP}
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
