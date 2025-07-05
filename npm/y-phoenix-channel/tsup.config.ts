import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/y-phoenix-channel.ts'],
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  dts: true,
  format: ['esm', 'cjs']
})