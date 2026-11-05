// SPDX-License-Identifier: GPL-2.0-or-later
// Opt-in inspection. All core state access occurs on the emulation thread.
#ifdef _WIN32
#include <winsock2.h>
#include <windows.h>
#endif
#include "fceu.h"
#include "driver.h"
#include "ppu.h"
#include "cart.h"
#include "x6502.h"
#include "video.h"
#include "palette.h"
#include "movie.h"
#include "utils/md5.h"
#include "input.h"
#include "emufile.h"
#include "state.h"
#include "rea.h"
#include <sstream>
#include <deque>
#include <vector>
#include <memory>
#include <cstdlib>
#include <cstring>
#include <algorithm>
#include <cstdio>

void REA_Startup(const char* stage) {
 const char* log=getenv("FCEUX_REA_STARTUP_LOG");
 if(log) { FILE* f=fopen(log,"a"); if(f) { fprintf(f,"%s\n",stage); fclose(f); } }
}

#ifdef _WIN32
extern uint8 PALRAM[32], SPRAM[256], joy[4], XOffset;
extern uint32 TempAddr, RefreshAddr;
extern void REA_SetWindowsSpeed(unsigned percent);
extern unsigned REA_GetWindowsSpeed();
extern bool isTaseditorRecording();
extern bool REA_OpenWindowsTool(unsigned tool);
namespace {
SOCKET sock = INVALID_SOCKET;
bool connecting = false, initialized = false, enabled = false, readHook = false, writeHook = false;
DWORD retryAt = 0;
unsigned port = 0, sequence = 0, epoch = 0, frames = 0, rasterLines = 0;
std::string token, input, session;
std::deque<std::vector<char> > output;
size_t sent = 0;
uint8 bg[256*240], sp[256*240], masks[240], screen[256*240], emphasis[256*240];
bool screenValid = false;
std::unique_ptr<EMUFILE_MEMORY> checkpoints[16];
unsigned checkpointFrames[16]={};
bool checkpointNewPpu[16]={},checkpointPal[16]={};
unsigned stepRequested=0,stepExecuted=0;
std::string stopReason="not executed";
unsigned stepLeft = 0, stepId = 0, pad0 = 0, pad1 = 0;
bool injectStepInput = false;
bool moviePlaybackOwned = false;
std::string inputDigest, digestGuid;
unsigned digestLength=0, digestRerecord=0;
unsigned traceLeft = 0, traceLimit = 0, watchStart = 0, watchEnd = 0, watchType = 0, instructionPC = 0;
bool watchHit = false, forceCapture = true, traceFinished = false;
struct Event { unsigned type, address, value, pc; uint64 cycle; unsigned a,x,y,s,p; };
std::vector<Event> events;
unsigned droppedEvents = 0;
std::string captureId;

void disconnect() {
 if(sock != INVALID_SOCKET) closesocket(sock);
 sock = INVALID_SOCKET; connecting = false; output.clear(); sent = 0; input.clear();
 // Losing the controlling client must not leave injected inputs held.
 if(stepLeft) { EmulationPaused = 1; stepLeft = 0; stepId = 0; }
 retryAt = GetTickCount()+1000;
}
void append32(std::vector<char>& v, unsigned n) {
 for(int i=0;i<4;i++) v.push_back(char(n>>(8*i)));
}
void queue(const std::string& json, const std::vector<char>& bytes = std::vector<char>()) {
 if(output.size() >= 8) { disconnect(); return; }
 std::vector<char> packet;
 append32(packet, unsigned(4+json.size()+bytes.size())); append32(packet, unsigned(json.size()));
 packet.insert(packet.end(),json.begin(),json.end()); packet.insert(packet.end(),bytes.begin(),bytes.end());
 output.push_back(std::move(packet));
}
void flush() {
 while(sock != INVALID_SOCKET && !connecting && !output.empty()) {
  auto& p = output.front(); int n = send(sock,p.data()+sent,int(p.size()-sent),0);
  if(n == SOCKET_ERROR) { if(WSAGetLastError()!=WSAEWOULDBLOCK) disconnect(); return; }
  if(n<=0) { disconnect(); return; }
  sent += n; if(sent == p.size()) { output.pop_front(); sent=0; }
 }
}
void reply(unsigned id, bool ok, const char* message) {
 std::ostringstream j; j << "{\"kind\":\"reply\",\"request\":" << id << ",\"ok\":" << (ok?"true":"false")
  << ",\"message\":\"" << message << "\",\"snapshot\":\"" << captureId << "\"}";
 queue(j.str());
}
std::string jsonString(const std::string& value) {
 std::ostringstream out; out << '"';
 const char* hex="0123456789abcdef";
 for(unsigned char c:value) {
  if(c=='"' || c=='\\') out << '\\' << char(c);
  else if(c<32) out << "\\u00" << hex[c>>4] << hex[c&15];
  else out << char(c);
 }
 out << '"'; return out.str();
}
std::string playbackState() {
 const EMOVIEMODE mode=FCEUMOV_Mode();
 const char* name=mode==MOVIEMODE_PLAY?"playback":mode==MOVIEMODE_RECORD?"recording":mode==MOVIEMODE_TASEDITOR?"tas-editor":mode==MOVIEMODE_FINISHED?"finished":"inactive";
 const bool active=mode!=MOVIEMODE_INACTIVE;
 std::string filename=active?FCEUI_GetMovieName():"";
 if(!filename.empty()){char full[32768];const DWORD n=GetFullPathNameA(filename.c_str(),sizeof(full),full,nullptr);if(n>0&&n<sizeof(full))filename.assign(full,n);}
 const size_t slash=filename.find_last_of("/\\");
 std::string romName=GameInfo&&GameInfo->name?(const char*)GameInfo->name:"";
 if(romName.empty()&&GameInfo&&GameInfo->filename){romName=GameInfo->filename;const size_t pos=romName.find_last_of("/\\");if(pos!=std::string::npos)romName=romName.substr(pos+1);}
 std::ostringstream out;
 out << "{\"paused\":" << (EmulationPaused?"true":"false") << ",\"speedPercent\":" << REA_GetWindowsSpeed()
 << ",\"frame\":" << FCEUMOV_GetFrame() << ",\"session\":" << jsonString(session) << ",\"emulatedFrames\":" << frames
 << ",\"region\":" << jsonString(PAL?"PAL":"NTSC") << ",\"ppuCore\":" << jsonString(newppu?"new":"old")
 << ",\"romName\":" << jsonString(romName)
 << ",\"checkpoints\":[";
 for(unsigned i=0;i<16;i++){if(i)out<<',';out<<"{\"slot\":"<<i<<",\"occupied\":"<<(checkpoints[i]?"true":"false")<<",\"frame\":"<<checkpointFrames[i]<<",\"compatible\":"<<(checkpoints[i]&&checkpointNewPpu[i]==bool(newppu)&&checkpointPal[i]==bool(PAL)?"true":"false")<<",\"ppuCore\":"<<jsonString(checkpointNewPpu[i]?"new":"old")<<",\"region\":"<<jsonString(checkpointPal[i]?"PAL":"NTSC")<<'}';}
 out << "],\"movie\":{\"mode\":" << jsonString(name)
 << ",\"name\":" << jsonString(filename.substr(slash==std::string::npos?0:slash+1)) << ",\"path\":" << jsonString(filename)
 << ",\"guid\":" << jsonString(active&&currMovieData.guid.isValid()?currMovieData.guid.toString():"")
 << ",\"length\":" << (active?FCEUI_GetMovieLength():0) << ",\"rerecordCount\":" << (active?FCEUI_GetMovieRerecordCount():0)
 << ",\"recording\":" << (mode==MOVIEMODE_RECORD || (mode==MOVIEMODE_TASEDITOR&&isTaseditorRecording())?"true":"false")
 << ",\"readOnly\":" << (movie_readonly?"true":"false") << ",\"frame\":" << FCEUMOV_GetFrame()
 << ",\"inputMd5\":" << jsonString(active && digestGuid==currMovieData.guid.toString() && digestLength==currMovieData.records.size() && digestRerecord==currMovieData.rerecordCount?inputDigest:"")
 << ",\"inputFrame\":" << (active&&FCEUMOV_GetFrame()>0&&FCEUMOV_GetFrame()<=FCEUI_GetMovieLength()?FCEUMOV_GetFrame()-1:-1) << "}}";
 return out.str();
}
void digestMovieInputs() {
 inputDigest.clear();
 if(FCEUMOV_Mode()==MOVIEMODE_INACTIVE || currMovieData.ports[2]!=0 || currMovieData.ports[0]>1 || currMovieData.ports[1]>1)return;
 md5_context ctx;md5_starts(&ctx);
 for(const auto& record:currMovieData.records){uint8 row[5]={record.commands,0,0,0,0};for(int k=0;k<4;k++)if(currMovieData.fourscore || (k<2 && currMovieData.ports[k]==1))row[k+1]=record.joysticks.data[k];md5_update(&ctx,row,5);}
 uint8 result[16];md5_finish(&ctx,result);const char* hex="0123456789abcdef";for(int i=0;i<16;i++){inputDigest+=hex[result[i]>>4];inputDigest+=hex[result[i]&15];}
 digestGuid=currMovieData.guid.toString();digestLength=unsigned(currMovieData.records.size());digestRerecord=currMovieData.rerecordCount;
}
void event(unsigned type,unsigned address,unsigned value) {
 if(events.size()<2048) events.push_back({type,address,value,instructionPC,timestampbase+timestamp,X.A,X.X,X.Y,X.S,X.P});
 else ++droppedEvents;
}
void exec(unsigned a,unsigned opcode) {
 instructionPC = a;
 if(traceLeft) { event(4,a,opcode); if(!--traceLeft) traceFinished=true; }
 if((watchType&4) && a>=watchStart && a<=watchEnd) { event(4,a,opcode); watchHit=true; }
}
void read(unsigned a,unsigned v,void*) {
 if((watchType&1) && a>=watchStart && a<=watchEnd) { event(1,a,v); watchHit=true; }
}
void write(unsigned a,unsigned v,void*) {
 if((watchType&2) && a>=watchStart && a<=watchEnd) { event(2,a,v); watchHit=true; }
}
void updateHooks() {
 const bool wantRead=(watchType&1)!=0,wantWrite=(watchType&2)!=0;
 if(wantRead!=readHook) { if(wantRead) X6502_MemHook::Add(X6502_MemHook::Read,read); else X6502_MemHook::Remove(X6502_MemHook::Read,read); readHook=wantRead; }
 if(wantWrite!=writeHook) { if(wantWrite) X6502_MemHook::Add(X6502_MemHook::Write,write); else X6502_MemHook::Remove(X6502_MemHook::Write,write); writeHook=wantWrite; }
}
void connectSocket() {
 if(!initialized) {
  initialized=true; const char* p=getenv("FCEUX_REA_PORT"), *t=getenv("FCEUX_REA_TOKEN");
  if(!p || !t || strlen(t)!=64) return;
  port=unsigned(atoi(p)); if(!port || port>65535) return;
  token=t; WSADATA w; if(WSAStartup(MAKEWORD(2,2),&w)) return;
  std::ostringstream s; s << GetCurrentProcessId() << "-" << GetTickCount64(); session=s.str(); enabled=true;
 }
 if(!enabled) return;
 if(sock==INVALID_SOCKET) {
  if(int(GetTickCount()-retryAt)<0) return;
  sock=socket(AF_INET,SOCK_STREAM,IPPROTO_TCP); if(sock==INVALID_SOCKET) { retryAt=GetTickCount()+1000; return; }
  u_long one=1; ioctlsocket(sock,FIONBIO,&one);
  sockaddr_in addr={}; addr.sin_family=AF_INET; addr.sin_port=htons((u_short)port); addr.sin_addr.s_addr=htonl(INADDR_LOOPBACK);
  if(connect(sock,(sockaddr*)&addr,sizeof(addr))==SOCKET_ERROR && WSAGetLastError()!=WSAEWOULDBLOCK) { disconnect(); return; }
  connecting=true;
 }
 if(connecting) {
  fd_set wr,er; FD_ZERO(&wr); FD_ZERO(&er); FD_SET(sock,&wr); FD_SET(sock,&er); timeval tv={0,0};
  if(select(0,nullptr,&wr,&er,&tv)<=0) return;
  int err=0,len=sizeof(err); getsockopt(sock,SOL_SOCKET,SO_ERROR,(char*)&err,&len);
  if(err || FD_ISSET(sock,&er)) { disconnect(); return; }
  connecting=false; queue("{\"kind\":\"hello\",\"token\":\""+token+"\"}"); forceCapture=true;
 }
}
void capture() {
 if(sock==INVALID_SOCKET || connecting || (!output.empty() && !forceCapture)) return;
 captureId=session+"-"+std::to_string(epoch)+"-"+std::to_string(++sequence);
 FILETIME time;GetSystemTimeAsFileTime(&time);ULARGE_INTEGER ticks;ticks.LowPart=time.dwLowDateTime;ticks.HighPart=time.dwHighDateTime;
 std::ostringstream j;
 j << "{\"kind\":\"snapshot\",\"version\":1,\"id\":\"" << captureId << "\",\"session\":" << jsonString(session) << ",\"frame\":" << FCEUMOV_GetFrame()
 << ",\"capturedAt\":" << ((ticks.QuadPart-116444736000000000ULL)/10000) << ",\"cycle\":" << (timestampbase+timestamp) << ",\"region\":\"" << (PAL?"PAL":"NTSC") << "\",\"paused\":" << (EmulationPaused?"true":"false")
 << ",\"playback\":" << playbackState()
 << ",\"screenValid\":" << (screenValid?"true":"false") << ",\"rasterValid\":" << (!newppu && rasterLines==240?"true":"false") << ",\"ppuCore\":\"" << (newppu?"new":"old") << "\",\"capturePoint\":\"after-ppu-before-osd\""
 << ",\"cpu\":{\"pc\":"<<X.PC<<",\"a\":"<<unsigned(X.A)<<",\"x\":"<<unsigned(X.X)<<",\"y\":"<<unsigned(X.Y)<<",\"s\":"<<unsigned(X.S)<<",\"p\":"<<unsigned(X.P)<<"}"
 << ",\"ppu\":{\"ctrl\":"<<unsigned(PPU[0])<<",\"mask\":"<<unsigned(PPU[1])<<",\"status\":"<<unsigned(PPU[2])<<",\"oamAddress\":"<<unsigned(PPU[3])<<",\"v\":"<<RefreshAddr<<",\"t\":"<<TempAddr<<",\"fineX\":"<<unsigned(XOffset)<<"}"
 << ",\"romMd5\":\"";
 const char* hex="0123456789abcdef"; if(GameInfo) for(int i=0;i<16;i++) j<<hex[GameInfo->MD5[i]>>4]<<hex[GameInfo->MD5[i]&15];
 j << "\",\"nametableAliases\":[";
 for(int i=0;i<4;i++) { if(i) j<<','; int alias=i; for(int k=0;k<i;k++) if(vnapage[i]==vnapage[k]) { alias=k; break; } j<<alias; }
 j << "],\"execution\":{\"requestedFrames\":"<<stepRequested<<",\"completedFrames\":"<<stepExecuted<<",\"stopReason\":"<<jsonString(stopReason)<<",\"granularity\":\"completed-frame-boundary\"},\"traceLimit\":"<<traceLimit<<",\"traceRemaining\":"<<traceLeft<<",\"eventsDropped\":"<<droppedEvents<<",\"watchHit\":"<<(watchHit?"true":"false")<<",\"events\":[";
 for(size_t i=0;i<events.size();i++) { auto&e=events[i]; if(i) j<<','; j<<'['<<e.type<<','<<e.address<<','<<e.value<<','<<e.pc<<','<<e.cycle<<','<<e.a<<','<<e.x<<','<<e.y<<','<<e.s<<','<<e.p<<']'; }
 j << "],\"buffers\":[[\"screen\",61440],[\"emphasis\",61440],[\"background\",61440],[\"sprites\",61440],[\"lineMasks\",240],[\"rgbPalette\",1536],[\"ram\",2048],[\"chr\",8192],[\"nametables\",4096],[\"oam\",256],[\"palette\",32]]}";
 std::vector<char> bytes; bytes.reserve(270000);
 auto add=[&](const void* p,size_t n) { const char* c=(const char*)p; bytes.insert(bytes.end(),c,c+n); };
 add(screen,sizeof(screen)); add(emphasis,sizeof(emphasis)); add(bg,sizeof(bg)); add(sp,sizeof(sp)); add(masks,sizeof(masks));
 add(palo,1536); add(RAM,2048);
 for(unsigned a=0;a<8192;a++) bytes.push_back(VPage[a>>10]?VPage[a>>10][a]:0);
 for(unsigned a=0;a<4096;a++) bytes.push_back(vnapage[a>>10]?vnapage[a>>10][a&1023]:0);
 add(SPRAM,256); add(PALRAM,32);
 queue(j.str(),bytes); forceCapture=false;
}
void command(const std::string& line) {
 std::istringstream in(line); unsigned id=0,a=0,b=0,c=0; std::string op; in>>id>>op;
 if(!id) { if(op=="capture") forceCapture=true; return; }
 if(op=="status") { std::ostringstream out;out << "{\"kind\":\"reply\",\"request\":" << id << ",\"ok\":true,\"state\":" << playbackState() << "}";queue(out.str());return; }
 if(op=="movie-open") {
  std::string encoded,filename;in>>encoded;
  if(encoded.empty() || encoded.size()>8192 || encoded.size()%2 || encoded.find_first_not_of("0123456789abcdef")!=std::string::npos || stepLeft || FCEUMOV_Mode(MOVIEMODE_RECORD|MOVIEMODE_TASEDITOR)) {reply(id,false,"finish recording or close TAS Editor before loading a movie");return;}
  for(size_t i=0;i<encoded.size();i+=2) filename+=char(strtoul(encoded.substr(i,2).c_str(),nullptr,16));
  if(filename.find('\0')!=std::string::npos) {reply(id,false,"invalid movie path");return;}
  bool loaded=FCEUI_LoadMovie(filename.c_str(),true,0);EmulationPaused=1;screenValid=false;rasterLines=0;
  capture();reply(id,loaded,"movie loaded read-only; advance one frame for rendered evidence");return;
 }
 in>>a>>b>>c;
 if((op=="run" || op=="movie-play" || op=="movie-step") && (FCEUMOV_Mode(MOVIEMODE_RECORD) || (FCEUMOV_Mode(MOVIEMODE_TASEDITOR) && isTaseditorRecording()))){reply(id,false,"disable movie recording before replaying from the REA page");return;}
 unsigned interrupted=0;
 if(stepLeft) { if(op=="pause" || op=="bookmark") { interrupted=stepId;stopReason="pause interrupted bounded step";stepLeft=stepId=0; EmulationPaused=1; } else { reply(id,false,"bounded execution is busy"); return; } }
 bool ok=true; const char* message="completed";
 if(op=="pause") EmulationPaused=1;
 else if(op=="bookmark") {EmulationPaused=1;digestMovieInputs();}
 else if(op=="native-tool") {EmulationPaused=1;ok=REA_OpenWindowsTool(a);message=ok?"native tool open/focus requested; its state is live, not bound to browser evidence":"native tool unavailable in the current mode";}
 else if(op=="movie-stop" && FCEUMOV_Mode(MOVIEMODE_PLAY|MOVIEMODE_FINISHED)) {EmulationPaused=1;FCEUI_StopMovie();moviePlaybackOwned=false;inputDigest.clear();}
 else if(op=="run") {moviePlaybackOwned=FCEUMOV_Mode(MOVIEMODE_PLAY);EmulationPaused=0;}
 else if(op=="speed" && a>=25 && a<=200 && a%25==0) REA_SetWindowsSpeed(a);
 else if(op=="movie-play" && (FCEUMOV_Mode(MOVIEMODE_TASEDITOR) || (FCEUMOV_Mode(MOVIEMODE_PLAY) && FCEUMOV_GetFrame()<FCEUI_GetMovieLength()))) {moviePlaybackOwned=true;EmulationPaused=0;}
 else if(op=="movie-restart" && FCEUMOV_Mode(MOVIEMODE_PLAY|MOVIEMODE_FINISHED)) {FCEUI_MoviePlayFromBeginning();EmulationPaused=1;screenValid=false;rasterLines=0;}
 else if(op=="movie-step" && a>=1 && a<=3600 && (FCEUMOV_Mode(MOVIEMODE_TASEDITOR) || (FCEUMOV_Mode(MOVIEMODE_PLAY) && FCEUMOV_GetFrame()<FCEUI_GetMovieLength()))) {stepRequested=a;stepExecuted=0;stopReason="executing";stepLeft=FCEUMOV_Mode(MOVIEMODE_PLAY)?std::min(a,unsigned(FCEUI_GetMovieLength()-FCEUMOV_GetFrame())):a;stepId=id;injectStepInput=false;EmulationPaused=0;return;}
 else if(op=="step" && a>=1 && a<=3600 && b<=255 && c<=255 && !FCEUMOV_Mode(MOVIEMODE_PLAY|MOVIEMODE_RECORD|MOVIEMODE_TASEDITOR) && joyports[0].type==SI_GAMEPAD && (joyports[1].type==SI_GAMEPAD || joyports[1].type==SI_NONE)) {
  stepRequested=a;stepExecuted=0;stopReason="executing";stepLeft=a; stepId=id; pad0=b; pad1=c; injectStepInput=true; EmulationPaused=0; return;
 }
 else if(op=="save" && a<16) {
  if(!EmulationPaused || FCEUMOV_Mode(MOVIEMODE_PLAY|MOVIEMODE_RECORD|MOVIEMODE_TASEDITOR)) { reply(id,false,"pause and stop movie before checkpoint"); return; }
  auto state=std::unique_ptr<EMUFILE_MEMORY>(new EMUFILE_MEMORY());
  ok=FCEUSS_SaveMS(state.get(),1); if(ok) {checkpoints[a]=std::move(state);checkpointFrames[a]=FCEUMOV_GetFrame();checkpointNewPpu[a]=bool(newppu);checkpointPal[a]=bool(PAL);}
 }
 else if(op=="load" && a<16 && checkpoints[a]) {
  if(checkpointNewPpu[a]!=bool(newppu)||checkpointPal[a]!=bool(PAL)){reply(id,false,"checkpoint uses a different PPU core or region");return;}
  if(!EmulationPaused || FCEUMOV_Mode(MOVIEMODE_PLAY|MOVIEMODE_RECORD|MOVIEMODE_TASEDITOR)) { reply(id,false,"pause and stop movie before restore"); return; }
  checkpoints[a]->fseek(0,SEEK_SET); ok=FCEUSS_LoadFP(checkpoints[a].get(),SSLOADPARAM_NOBACKUP);
  EmulationPaused=1; ++epoch; rasterLines=0; screenValid=false; events.clear(); traceLeft=0; traceFinished=false; watchHit=false;
 }
 else if(op=="trace" && a>=1 && a<=2048) { events.clear(); droppedEvents=0; traceLimit=traceLeft=a; traceFinished=false; }
 else if(op=="watch" && a<=b && b<=65535 && c<=7) { watchStart=a; watchEnd=b; watchType=c; updateHooks(); watchHit=false; events.clear(); droppedEvents=0; }
 else { ok=false; message="unsupported command or invalid state"; }
 forceCapture=true; capture();if(interrupted)reply(interrupted,false,"interrupted by pause at completed frame boundary");reply(id,ok,message);
}
}
void REA_Poll() {
 connectSocket(); if(sock==INVALID_SOCKET || connecting) return;
 flush(); if(sock==INVALID_SOCKET) return;
 char buf[4096];
 // Bounded polling: a local producer cannot monopolize the emulation thread.
 for(int i=0;i<4;i++) {
  int n=recv(sock,buf,sizeof(buf),0);
  if(n==0) { disconnect(); return; }
  if(n<0) { if(WSAGetLastError()!=WSAEWOULDBLOCK) disconnect(); break; }
  input.append(buf,n); if(input.size()>16384) { disconnect(); return; }
 }
 for(int i=0;i<16;i++) { size_t nl=input.find('\n'); if(nl==std::string::npos) break; std::string line=input.substr(0,nl); input.erase(0,nl+1); command(line); }
 if(forceCapture) capture(); flush();
}
void REA_BeginFrame() {
 if(!enabled) return;
 rasterLines=0; memset(bg,0,sizeof(bg)); memset(sp,0,sizeof(sp));
}
void REA_Input() {
 if(stepLeft && injectStepInput) { joy[0]=uint8(pad0); joy[1]=uint8(pad1); joy[2]=joy[3]=0; }
}
void REA_Opcode(uint8 opcode) { if(enabled && (traceLeft || watchType)) exec(X.PC,opcode); }
void REA_RasterLine(int y,const uint8* background,const uint8* sprites,bool valid,uint8 mask) {
 if(!enabled || y<0 || y>=240) return;
 memcpy(bg+y*256,background,256); masks[y]=mask;
 if(valid && (mask&16)) for(int x=(mask&4)?0:8;x<256;x++) { uint8 v=sprites[x]; if(!(v&128)) sp[y*256+x]=(v&63)|128; }
 ++rasterLines;
}
void REA_EndFrame() {
 if(!enabled) return;
 memcpy(screen,XBuf,sizeof(screen)); memcpy(emphasis,XDBuf,sizeof(emphasis)); screenValid=true;
 ++frames;
 bool stop=watchHit || traceFinished;
 const bool movieEnded=moviePlaybackOwned && FCEUMOV_Mode(MOVIEMODE_PLAY) && FCEUMOV_GetFrame()>=FCEUI_GetMovieLength();
 if(movieEnded){stop=true;moviePlaybackOwned=false;}
 if(stepLeft && !injectStepInput && FCEUMOV_Mode(MOVIEMODE_FINISHED)) stop=true;
 if(stepLeft) {++stepExecuted;if(!--stepLeft)stop=true;}
 if(stop)stopReason=watchHit?"watch hit":traceFinished?"trace limit":movieEnded?"movie end":"bounded step complete";
 if(stop) EmulationPaused=1;
 if(stop || forceCapture) { forceCapture=true; capture(); }
 if(stepId && (!stepLeft || stop)) { reply(stepId,true,watchHit?"stopped at frame boundary after watch hit":traceFinished?"stopped at frame boundary after trace limit":"stepped"); stepId=stepLeft=0; }
 // Keep evidence until the next watch/trace command, but do not repeatedly pause resume.
 watchHit=false; traceFinished=false; flush();
}
void REA_Reset() {
 inputDigest.clear();moviePlaybackOwned=false;
 stepRequested=stepExecuted=0;stopReason="machine reset or ROM changed";
 memset(checkpointFrames,0,sizeof(checkpointFrames));
 ++epoch; for(auto& cp:checkpoints) cp.reset(); stepLeft=stepId=traceLeft=watchType=0; updateHooks();
 events.clear(); droppedEvents=0; rasterLines=0; screenValid=false; forceCapture=true;
}
#else
void REA_Poll() {}
void REA_BeginFrame() {}
void REA_EndFrame() {}
void REA_RasterLine(int,const uint8*,const uint8*,bool,uint8) {}
void REA_Input() {}
void REA_Opcode(uint8) {}
void REA_Reset() {}
#endif
