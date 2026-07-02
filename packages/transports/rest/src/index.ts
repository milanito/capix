/**
 * index.ts — public API for capix-transport-rest
 */

export { restTransport } from './transport.js';
export type { RestTransportOptions } from './transport.js';
export { compileRouter, generateRoutes } from './router.js';
export type { RouteDefinition, RouterMatch, Router, GenerateRoutesOptions, HttpOverride } from './router.js';
export { uploadedFile } from './multipart.js';
export type { UploadedFile, MultipartOptions } from './multipart.js';
export { generateOpenAPI } from './openapi.js';
export type { OpenAPIOptions, OpenAPIServer } from './openapi.js';
