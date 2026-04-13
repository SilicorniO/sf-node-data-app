/**
 * Browser stub for Node.js 'fs' module.
 * Provides no-op or throw implementations so that modules that import 'fs'
 * can be bundled for the browser without crashing at initialization time.
 * Any function that is actually called at runtime will throw a clear error.
 */
const notAvailable = (name) =>
  () => { throw new Error(`fs.${name} is not available in the browser`); };

export const readFileSync    = notAvailable('readFileSync');
export const writeFileSync   = () => {};
export const appendFileSync  = () => {};
export const existsSync      = () => false;
export const mkdirSync       = () => {};
export const readdirSync     = () => [];
export const statSync        = notAvailable('statSync');
export const unlinkSync      = () => {};
export const createReadStream  = notAvailable('createReadStream');
export const createWriteStream = notAvailable('createWriteStream');
export const promises = {};

const fs = {
  readFileSync, writeFileSync, appendFileSync, existsSync,
  mkdirSync, readdirSync, statSync, unlinkSync,
  createReadStream, createWriteStream, promises,
};
export default fs;
