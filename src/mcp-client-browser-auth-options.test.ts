/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import { describe, expect, mock, test } from "bun:test";
import { createBrowserAuthOptions } from "./mcp-client.js";

describe("createBrowserAuthOptions", () => {
  test("passes oauth storeKey through", () => {
    const store = { get: mock(), set: mock(), delete: mock() };

    const options = createBrowserAuthOptions({
      store,
      storeKey: "custom-oauth-tokens",
    });

    expect(options.store).toBe(store);
    expect(options.storeKey).toBe("custom-oauth-tokens");
  });

  test("passes through additional browserAuth options", () => {
    const onRequest = mock(() => {});

    const options = createBrowserAuthOptions({
      authServerUrl: "https://auth.example.com",
      errorHtml: "custom error",
      onRequest,
      successHtml: "custom success",
    });

    expect(options).toEqual(
      expect.objectContaining({
        authServerUrl: "https://auth.example.com",
        errorHtml: "custom error",
        onRequest,
        successHtml: "custom success",
      }),
    );
  });

  test("preserves browserAuth defaults when oauth options are omitted", () => {
    const store = { get: mock(), set: mock(), delete: mock() };
    const createStore = mock(() => store);

    const options = createBrowserAuthOptions({}, createStore);

    expect(createStore).toHaveBeenCalledTimes(1);
    expect(options).toEqual(
      expect.objectContaining({
        authTimeout: 300000,
        callbackPath: "/callback",
        hostname: "localhost",
        port: 3000,
        store,
      }),
    );
  });
});
