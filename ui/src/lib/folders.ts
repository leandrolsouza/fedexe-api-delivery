export const FOLDER_SEPARATOR = ' / ';

export const folderPath = (parent: string, name: string) =>
  parent ? `${parent}${FOLDER_SEPARATOR}${name}` : name;

export const isInFolder = (path: string, folder: string) =>
  path === folder || path.startsWith(folder + FOLDER_SEPARATOR);

export function canRelocateFolder(paths: string[], source: string, target: string) {
  return (
    paths.includes(source) &&
    !isInFolder(target, source) &&
    !paths.some((path) => isInFolder(path, target) && !isInFolder(path, source))
  );
}

export function indexFolders(paths: string[]) {
  const known = new Set(paths);
  const children = new Map<string, string[]>();
  for (const path of known) {
    if (!path) continue;
    let parent = path;
    do {
      const separator = parent.lastIndexOf(FOLDER_SEPARATOR);
      parent = separator === -1 ? '' : parent.slice(0, separator);
    } while (parent && !known.has(parent));
    const siblings = children.get(parent);
    if (siblings) siblings.push(path);
    else children.set(parent, [path]);
  }
  return children;
}
