// Copyright (c) 2016, Compiler Explorer Authors
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

import path from 'node:path';

import type {ExecutionOptionsWithEnv} from '../../types/compilation/compilation.interfaces.js';
import type {PreliminaryCompilerInfo} from '../../types/compiler.interfaces.js';
import type {ParseFiltersAndOutputOptions} from '../../types/features/filters.interfaces.js';
import {BaseCompiler} from '../base-compiler.js';
import {CompilationEnvironment} from '../compilation-env.js';
import {MapFileReaderVS} from '../mapfiles/map-file-vs.js';
import {VcAsmParser} from '../parsers/asm-parser-vc.js';
import {PELabelReconstructor} from '../pe32-support.js';

import {VCParser} from './argument-parsers.js';

export class WineVcCompiler extends BaseCompiler {
    static get key() {
        return 'wine-vc';
    }

    constructor(info: PreliminaryCompilerInfo, env: CompilationEnvironment) {
        info.supportsFiltersInBinary = true;
        super(info, env);
        this.asm = new VcAsmParser();
    }

    override filename(fn: string) {
        return 'Z:' + fn;
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

        execOptions.customCwd = path.dirname(inputFilename);
        if (inputFilename.startsWith('Z:')) {
            execOptions.customCwd = execOptions.customCwd.substring(2);
        }

        return await super.runCompiler(compiler, options, inputFilename, execOptions);
    }

    override getArgumentParserClass() {
        return VCParser;
    }

    override getExecutableFilename(dirPath: string, outputFilebase: string) {
        return this.getOutputFilename(dirPath, outputFilebase) + '.exe';
    }

    override getObjdumpOutputFilename(defaultOutputFilename: string) {
        return this.getExecutableFilename(path.dirname(defaultOutputFilename), 'output');
    }

    override getSharedLibraryPathsAsArguments() {
        return [];
    }

    override optionsForFilter(filters: ParseFiltersAndOutputOptions, outputFilename: string) {
        if (filters.binary) {
            const mapFilename = outputFilename + '.map';
            const mapFileReader = new MapFileReaderVS(mapFilename);

            filters.preProcessBinaryAsmLines = (asmLines: string[]) => {
                const reconstructor = new PELabelReconstructor(asmLines, false, mapFileReader);
                reconstructor.run('output.s.obj');

                return reconstructor.asmLines;
            };

            return [
                '/nologo',
                '/FA',
                '/Fa' + this.filename(outputFilename),
                '/Fo' + this.filename(outputFilename + '.obj'),
                '/Fm' + this.filename(mapFilename),
                '/Fe' + this.filename(this.getExecutableFilename(path.dirname(outputFilename), 'output')),
            ];
        }
        return [
            '/nologo',
            '/FA',
            '/c',
            '/Fa' + this.filename(outputFilename),
            '/Fo' + this.filename(outputFilename + '.obj'),
        ];
    }
}
