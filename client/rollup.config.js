import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import terser from "@rollup/plugin-terser";

export default [
  {
    input: "src/index.ts",
    output: [
      {
        file: "dist/bundle/bundle.js",
        format: "iife",
        name: "zerohub",
        sourcemap: true,
      },
    ],
    plugins: [
      commonjs(),
      nodeResolve({ preferBuiltins: true }),
      typescript(),
      terser(),
    ],
  },
];
