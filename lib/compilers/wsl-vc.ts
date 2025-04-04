// Copyright (c) 2017, Andrew Pardoe
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//
//     * Redistributions of source code must retain the above copyright notice,
//       this list of conditions and the following disclaimer.
//     * Redistributions in binary form must reproduce the above copyright
//       notice, this list of conditions and the following disclaimer in the
//       documentation and/or other materials provided with the distribution.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
// ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
// LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
// CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
// SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
// CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
// ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
// POSSIBILITY OF SUCH DAMAGE.

// The main difference from wine-vc.js is that we translate
// compiler path from Unix mounted volume (/mnt/c/tmp) to Windows (c:/tmp)

import os from 'node:os';
import path from 'node:path';

import type {ExecutionOptions, ExecutionOptionsWithEnv} from '../../types/compilation/compilation.interfaces.js';
import type {PreliminaryCompilerInfo} from '../../types/compiler.interfaces.js';
import {unwrap} from '../assert.js';
import {CompilationEnvironment} from '../compilation-env.js';
import {VcAsmParser} from '../parsers/asm-parser-vc.js';

import {Win32VcCompiler} from './win32-vc.js';

export class WslVcCompiler extends Win32VcCompiler {
    static override get key() {
        return 'wsl-vc';
    }

    constructor(info: PreliminaryCompilerInfo, env: CompilationEnvironment) {
        super(info, env);
        this.asm = new VcAsmParser();
    }

    override filename(fn: string, tmpDirForTest?: string) {
        // AP: Need to translate compiler paths from what the Node.js process sees
        // on a Unix mounted volume (/mnt/c/tmp) to what CL sees on Windows (c:/tmp)
        // We know os.tmpdir() is of format /mnt/X/dir where X is drive letter.
        const tmpdir = tmpDirForTest || os.tmpdir();
        const driveLetter = unwrap(tmpdir).substring(5, 6);
        const directoryPath = unwrap(tmpdir).substring(7);
        const windowsStyle = driveLetter.concat(':/', directoryPath);
        return fn.replace(unwrap(tmpdir), windowsStyle);
    }

    override exec(compiler: string, args: string[], options_: ExecutionOptions) {
        const options = Object.assign({}, options_);
        options.env = Object.assign({}, options.env);

        let old_env = options.env['WSLENV'];
        if (old_env) {
            old_env = ':' + old_env;
        } else {
            old_env = '';
        }
        options.env['WSLENV'] = 'INCLUDE:LIB' + old_env;

        return super.exec(compiler, args, options);
    }

    override async runCompiler(
        compiler: string,
        options: string[],
        inputFilename: string,
        execOptions: ExecutionOptionsWithEnv,
    ) {
        if (!execOptions) {
            execOptions = this.getDefaultExecOptions();
        }

        // inputFilename is guaranteed to be Windows formatted (e.g. c:/) but
        // Node.js needs the Unix syntax
        const inputDirectory = path.dirname(inputFilename);
        const driveLetter = inputDirectory.substring(0, 1).toLowerCase();
        const directoryPath = inputDirectory.substring(2).trim();
        execOptions.customCwd = path.join('/mnt', driveLetter, directoryPath);

        return await super.runCompiler(compiler, options, inputFilename, execOptions);
    }
}
