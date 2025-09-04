#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';

function incrementVersion(version: string): string {
  const parts = version.split('.');
  if (parts.length !== 3) {
    throw new Error(`Invalid version format: ${version}`);
  }

  const major = parseInt(parts[0], 10);
  const minor = parseInt(parts[1], 10);
  const patch = parseInt(parts[2], 10);

  return `${major}.${minor}.${patch + 1}`;
}

function findPackageJsonFiles(packagesDir: string): string[] {
  const packageJsonPaths: string[] = [];

  if (!fs.existsSync(packagesDir)) {
    console.error(`Packages directory not found: ${packagesDir}`);
    return packageJsonPaths;
  }

  const entries = fs.readdirSync(packagesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const packageJsonPath = path.join(packagesDir, entry.name, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        packageJsonPaths.push(packageJsonPath);
      }
    }
  }

  return packageJsonPaths;
}

function updatePackageVersions() {
  const packagesDir = path.join(process.cwd(), 'packages');
  const packageJsonPaths = findPackageJsonFiles(packagesDir);

  if (packageJsonPaths.length === 0) {
    console.log('No package.json files found in packages folder');
    return;
  }

  console.log(`Found ${packageJsonPaths.length} package.json files:`);

  for (const packageJsonPath of packageJsonPaths) {
    try {
      const content = fs.readFileSync(packageJsonPath, 'utf8');
      const packageJson = JSON.parse(content);

      if (!packageJson.version) {
        console.log(`Skipping ${packageJsonPath} - no version field`);
        continue;
      }

      const oldVersion = packageJson.version;
      const newVersion = incrementVersion(oldVersion);

      packageJson.version = newVersion;

      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

      console.log(
        `Updated ${path.relative(process.cwd(), packageJsonPath)}: ${oldVersion} � ${newVersion}`
      );
    } catch (error) {
      console.error(`Error updating ${packageJsonPath}:`, error);
    }
  }
}

updatePackageVersions();
