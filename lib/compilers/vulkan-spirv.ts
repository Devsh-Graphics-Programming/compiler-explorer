// Copyright (c) 2018, 2021, Compiler Explorer Authors, Arm Ltd
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

import path from 'path';

import type {ExecutionOptions} from '../../types/compilation/compilation.interfaces.js';
import type {PreliminaryCompilerInfo} from '../../types/compiler.interfaces.js';
import type {ParseFiltersAndOutputOptions} from '../../types/features/filters.interfaces.js';
import {BaseCompiler} from '../base-compiler.js';
import {logger} from '../logger.js';
import {SPIRVAsmParser} from '../parsers/asm-parser-spirv.js';
import * as utils from '../utils.js';
import { splitArguments } from '../../shared/common-utils.js';
import {unwrap} from '../assert.js';
import type {ConfiguredOverrides} from '../../types/compilation/compiler-overrides.interfaces.js';
import {LLVMIrBackendOptions} from '../../types/compilation/ir.interfaces.js';
import {ResultLine} from '../../types/resultline/resultline.interfaces.js';

export class VulkanSPIRVCompiler extends BaseCompiler {
    protected translatorPath: string;
    protected disassemblerPath: string;

    static get key() {
        return 'vulkan-spirv';
    }

    constructor(compilerInfo: PreliminaryCompilerInfo, env) {
        super(compilerInfo, env);

        this.asm = new SPIRVAsmParser(this.compilerProps);

        this.translatorPath = this.compilerProps<string>('translatorPath');
        this.disassemblerPath = this.compilerProps<string>('disassemblerPath');
    }

    override prepareArguments(
        userOptions: string[],
        filters: ParseFiltersAndOutputOptions,
        backendOptions: Record<string, any>,
        inputFilename: string,
        outputFilename: string,
        libraries,
        overrides: ConfiguredOverrides,
    ) {
        let options = this.optionsForFilter(filters, outputFilename);
        backendOptions = backendOptions || {};

        if (this.compiler.options) {
            const compilerOptions = 
                splitArguments(this.compiler.options)
                .filter(option => option !== '-fno-crash-diagnostics');

            options = options.concat(compilerOptions);
        }

        if (this.compiler.supportsOptOutput && backendOptions.produceOptInfo) {
            options = options.concat(unwrap(this.compiler.optArg));
        }

        const libIncludes = this.getIncludeArguments(libraries, path.dirname(inputFilename));
        const libOptions = this.getLibraryOptions(libraries);
        let libLinks: string[] = [];
        let libPaths: string[] = [];
        let staticLibLinks: string[] = [];

        if (filters.binary) {
            libLinks = this.getSharedLibraryLinks(libraries);
            libPaths = this.getSharedLibraryPathsAsArguments(libraries, undefined, undefined, path.dirname(inputFilename));
            staticLibLinks = this.getStaticLibraryLinks(libraries);
        }

        userOptions = this.filterUserOptions(userOptions) || [];
        return options.concat(
            libIncludes,
            libOptions,
            libPaths,
            libLinks,
            userOptions,
            [this.filename(inputFilename)],
            staticLibLinks,
        );
    }

    override optionsForFilter(filters: ParseFiltersAndOutputOptions, outputFilename: string) {
        const sourceDir = path.dirname(outputFilename);
        const bitcodeFilename = path.join(sourceDir, this.outputFilebase + '.spv');
        return ['-o', bitcodeFilename];
    }

    getPrimaryOutputFilename(dirPath: string, outputFilebase: string) {
        return path.join(dirPath, `${outputFilebase}.bc`);
    }

    override getOutputFilename(dirPath: string, outputFilebase: string) {
        return path.join(dirPath, `${outputFilebase}.spvasm`);
    }

    override async runCompiler(
        compiler: string,
        options: string[],
        inputFilename: string,
        execOptions: ExecutionOptions & {env: Record<string, string>},
    ) {
        const sourceDir = path.dirname(inputFilename);
        const bitcodeFilename = path.join(sourceDir, this.outputFilebase + '.spv');

        if (!execOptions) {
            execOptions = this.getDefaultExecOptions();
        }
        execOptions.customCwd = path.dirname(inputFilename);

        const newOptions = options;
        //newOptions.push('-emit-llvm-bc');

        const bitcode = await this.exec(compiler, newOptions, execOptions);
        const result = this.transformToCompilationResult(bitcode, inputFilename);
        if (bitcode.code !== 0 || !(await utils.fileExists(bitcodeFilename))) {
            return result;
        }

        const spvBinFilename = path.join(sourceDir, this.outputFilebase + '.spv');
        /*const translatorFlags = ['-spirv-debug', bitcodeFilename, '-o', spvBinFilename];

        const spvBin = await this.exec(this.translatorPath, translatorFlags, execOptions);
        result.stdout = result.stdout.concat(utils.parseOutput(spvBin.stdout));
        result.stderr = result.stderr.concat(utils.parseOutput(spvBin.stderr));
        if (spvBin.code !== 0) {
            logger.error('LLVM to SPIR-V translation failed', spvBin);
            return result;
        }*/

        const spvasmFilename = path.join(sourceDir, this.outputFilebase + '.spvasm');
        const disassemblerFlags = [spvBinFilename, '-o', spvasmFilename];

        const spvasmOutput = await this.exec(this.disassemblerPath, disassemblerFlags, execOptions);
        if (spvasmOutput.code !== 0) {
            logger.error('SPIR-V binary to text failed', spvasmOutput);
        }

        result.stdout = result.stdout.concat(utils.parseOutput(spvasmOutput.stdout));
        result.stderr = result.stderr.concat(utils.parseOutput(spvasmOutput.stderr));
        result.languageId = 'spirv';
        return result;
    }

    async runCompilerForASTOrIR(
        compiler: string,
        options: any[],
        inputFilename: string,
        execOptions: ExecutionOptions & {env: Record<string, string>},
    ) {
        if (!execOptions) {
            execOptions = this.getDefaultExecOptions();
        }

        execOptions.customCwd = path.dirname(inputFilename);

        const sourceDir = path.dirname(inputFilename);
        const outputFile = path.join(sourceDir, this.outputFilebase + '.bc');

        const newOptions = options;
        newOptions.concat('-S');

        const index = newOptions.indexOf(outputFile);
        if (index !== -1) {
            newOptions[index] = utils.changeExtension(inputFilename, '.ll');
        }

        return super.runCompiler(compiler, newOptions, inputFilename, execOptions);
    }

    override async generateAST(inputFilename, options): Promise<ResultLine[]> {
        const newOptions = options.filter(option => option !== '-fcolor-diagnostics').concat(['-ast-dump']);

        const execOptions = this.getDefaultExecOptions();
        execOptions.maxOutput = 1024 * 1024 * 1024;

        return this.llvmAst.processAst(
            await this.runCompilerForASTOrIR(this.compiler.exe, newOptions, this.filename(inputFilename), execOptions),
        );
    }

    override async generateIR(
        inputFilename: string,
        options: string[],
        irOptions: LLVMIrBackendOptions,
        produceCfg: boolean,
        filters: ParseFiltersAndOutputOptions,
    ) {
        const newOptions = options.filter(option => option !== '-fcolor-diagnostics').concat('-emit-llvm');

        const execOptions = this.getDefaultExecOptions();
        execOptions.maxOutput = 1024 * 1024 * 1024;

        const output = await this.runCompilerForASTOrIR(
            this.compiler.exe,
            newOptions,
            this.filename(inputFilename),
            execOptions,
        );
        if (output.code !== 0) {
            logger.error('Failed to run compiler to get IR code');
            return {
                asm: output.stderr,
            };
        }
        const ir = await this.processIrOutput(output, irOptions, filters);
        return {
            asm: ir.asm,
        };
    }
}
