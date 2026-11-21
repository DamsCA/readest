// Windows only, loaded with NODE_OPTIONS=--import by scripts/deploy-ouiread.sh.
//
// OpenNext copies the traced server files and recreates pnpm's symlinks inside
// .open-next. Windows refuses to create symlinks without admin rights or
// Developer Mode (EPERM). On EPERM this falls back to what Windows allows:
// a directory junction for folders, a plain copy for files.
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';

const symlinkSync = fs.symlinkSync;

fs.symlinkSync = function symlinkSyncWithFallback(target, linkPath, type) {
  try {
    return symlinkSync.call(fs, target, linkPath, type);
  } catch (error) {
    if (error?.code !== 'EPERM') throw error;
    const absoluteTarget = path.resolve(path.dirname(String(linkPath)), String(target));
    if (fs.statSync(absoluteTarget).isDirectory()) {
      return symlinkSync.call(fs, absoluteTarget, linkPath, 'junction');
    }
    return fs.copyFileSync(absoluteTarget, linkPath);
  }
};

// Modules that import { symlinkSync } from 'node:fs' see the patched function.
syncBuiltinESMExports();
