import { defineConfig } from '@shware/workflow';
import { push } from './registry';

export default defineConfig({
  workflows: [],
  templates: { push: push as never },
});
