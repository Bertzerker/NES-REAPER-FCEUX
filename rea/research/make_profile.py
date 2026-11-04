from pathlib import Path
import json,hashlib
r=Path('roms/Akumajou Special - Boku Dracula-kun (Japan).nes').read_bytes()[16:]
assert hashlib.md5(r).hexdigest()=='96084e640ed9a02c644b39986c269662', 'Wrong ROM revision'
def data(bank,a,n):return list(r[bank*8192+(a&8191):bank*8192+(a&8191)+n])
def ram(a,stride=0):return dict(ram=a,**({'stride':stride} if stride else {}))
def op(name,*args):return dict(op=name,args=list(args))
def signed(n):return n if n<128 else n-256
mode=op('all',op('eq',ram(0x18),3),op('eq',ram(0x19),0))
inverted=op('and',ram(0xad),128)
xs=data(15,0xe803,12);ys=data(15,0xe81b,12);yi=data(15,0xe833,12)
shapes=[]
for i in range(12):
 label=['right foot','left foot','left lower side','left middle side','left upper side','right lower side','right middle side','right upper side','right head','left head','center lower','center foot'][i]
 shapes.append(dict(kind='point',label=f'{label} (probe {i})',x=signed(xs[i]),y=op('select',inverted,signed(yi[i]),signed(ys[i])),color='#69e3ff',confidence='code-derived',evidence='Fixed PRG bank 15: $E671 adds signed offsets from $E803/$E81B (or $E833 when $AD bit 7 is set) to $053C/$051E. Potential probe, not necessarily called every frame.',observedPc=0xe671,probeIndex=i))
enemyType=ram(0x5c6,1);flags=ram(0x7a6,1);override=op('and',flags,31)
row=op('select',override,override,op('div',op('table',data(15,0xe83e,152),op('add',op('and',enemyType,127),op('select',op('eq',ram(0x3c),8),128,0))),4))
raw=data(13,0xbd12,104)
p=dict(version=1,id='kid-dracula-jp',title='Akumajou Special — Boku Dracula-kun (Japan)',romMd5=['96084e640ed9a02c644b39986c269662'],notes='Player terrain probes and exact per-counterpart contact windows recovered from this ROM. Orange rectangles show where an enemy origin triggers the player contact test, including both objects\u2019 dimensions. They are not independent hurt rectangles. Cyan marks are potential terrain samples. Grey windows indicate damage is currently gated. Row 4/type $06 replay verified in stage 0. Other rows are code-derived; special bosses/forms remain unvalidated. End-of-frame RAM can differ from positions earlier in that frame.',classes=[dict(id='player',label='Player',count=1,active=op('all',mode,op('ne',ram(0x500),0),op('eq',ram(0x578),0),op('eq',ram(0x596),0)),x=ram(0x53c),y=ram(0x51e),shapes=shapes),dict(id='enemies',label='Enemy / contact object',count=18,active=op('all',mode,op('ne',enemyType,0),op('ne',ram(0x50c,1),0),op('eq',ram(0x5a2,1),0),op('eq',ram(0x584,1),0),op('lt',ram(0x52a,1),192)),x=ram(0x548,1),y=ram(0x52a,1),shapes=[dict(kind='point',label='Enemy origin',color='#f89ce5',confidence='code-derived',evidence='Object update $E970 and contact entry bank 13:$BC96 read $0548+X / $052A+X; count 18 from $E96B.')])],contactRules=[dict(algorithm='6502-contact-window-v1',label='Player contact window',playerClass='player',targetClass='enemies',row=row,rows=[raw[i:i+4] for i in range(0,len(raw),4)],carry=op('select',override,0,op('gte',ram(0x3c),8)),enabled=op('any',op('lt',enemyType,5),op('all',op('lt',ram(0xa2),8),op('eq',ram(0xc0),0),op('eq',op('and',flags,160),0))),trimEnabled=op('and',ram(0xb1),128),trimInverted=inverted,verifiedRows=[4],evidence='Bank 13:$BC96..$BD11; row offsets fixed $E83E or ($07A6+X & $1F)*4; four-byte rows bank 13:$BD12. $BCF3 marks contact, $BD0B jumps to $DD88 (DEC $AA). Stage-0 type $06/row 4 reproduced health 3→2; see research/KID-DRACULA.md.')])
p['contactRules'][0]['verifiedWhen']=op('all',op('eq',ram(0x3c),0),op('eq',op('and',ram(0xb1),128),0),op('eq',op('and',ram(0xad),192),0),op('eq',enemyType,6))
Path('rea/helpers/kid-dracula-jp.json').write_text(json.dumps(p,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
