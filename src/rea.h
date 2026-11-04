// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include "types.h"
void REA_Poll();
void REA_BeginFrame();
void REA_EndFrame();
void REA_RasterLine(int y, const uint8* background, const uint8* sprites, bool spriteValid, uint8 mask);
void REA_Input();
void REA_Opcode(uint8 opcode);
void REA_Reset();
void REA_Startup(const char* stage);
