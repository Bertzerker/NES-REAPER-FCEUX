from pathlib import Path
import capstone,sys
rom=next(Path('roms').glob('*.nes')).read_bytes()[16:16+131072]
c=capstone.Cs(capstone.CS_ARCH_MOS65XX,capstone.CS_MODE_MOS65XX_6502);c.skipdata=True
for arg in sys.argv[1:]:
 b,a,n=[int(x,16) for x in arg.split(':')];o=b*8192+(a&8191)
 print(f'BANK {b:02X} CPU {a:04X}')
 for i in c.disasm(rom[o:o+n],a): print(f'{i.address:04X} {i.bytes.hex():8s} {i.mnemonic} {i.op_str}')
