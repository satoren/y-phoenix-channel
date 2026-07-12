import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/y-phoenix-channel.ts'],
  sourcemap: true,
  clean: true,
  minify: false,
  dts: true,
  format: ['esm', 'cjs']
})