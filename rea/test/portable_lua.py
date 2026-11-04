# SPDX-License-Identifier: GPL-2.0-or-later
# Verify an extracted release manifest and the real Lua DLL compatibility chain.
from pathlib import Path
import ctypes,os,json,hashlib,sys
root=Path(sys.argv[1]).resolve();d=root/'rea'/'bin'
manifest=json.loads((root/'release-manifest.json').read_text(encoding='utf-8-sig'))
for entry in manifest['files']:
 p=root/entry['path']
 assert p.stat().st_size==entry['bytes'] and hashlib.sha256(p.read_bytes()).hexdigest()==entry['sha256'],entry['path']
with os.add_dll_directory(str(d)):
 lua=ctypes.CDLL(str(d/'lua51.dll'))
 lua.luaL_newstate.restype=ctypes.c_void_p
 lua.luaL_openlibs.argtypes=[ctypes.c_void_p]
 lua.luaL_loadstring.argtypes=[ctypes.c_void_p,ctypes.c_char_p]
 lua.lua_pcall.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_int,ctypes.c_int]
 lua.lua_tolstring.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_void_p];lua.lua_tolstring.restype=ctypes.c_char_p
 lua.lua_close.argtypes=[ctypes.c_void_p]
 state=lua.luaL_newstate();assert state
 try:
  lua.luaL_openlibs(state)
  assert lua.luaL_loadstring(state,b'assert(2+2==4); return _VERSION')==0
  assert lua.lua_pcall(state,0,1,0)==0
  version=lua.lua_tolstring(state,-1,None).decode();assert version=='Lua 5.1'
 finally:lua.lua_close(state)
print(json.dumps({'manifestFilesVerified':len(manifest['files']),'sourceCommit':manifest['sourceCommit'],'portableLuaShimAndCore':version,'nodeVersion':manifest['nodeVersion']}))
