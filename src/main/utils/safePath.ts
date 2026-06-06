/*
 * Path traversal guard for theme / asset reads.
 */

import { join, normalize } from "path";

export function ensureSafePath(basePath: string, path: string) {
    const normalizedBasePath = normalize(basePath + "/");
    const newPath = join(basePath, path);
    const normalizedPath = normalize(newPath);
    return normalizedPath.startsWith(normalizedBasePath) ? normalizedPath : null;
}
