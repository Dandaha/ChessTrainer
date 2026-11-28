import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  globalThis.localStorage?.clear(); // absent in tests that run without a browser
  globalThis.sessionStorage?.clear();
});
