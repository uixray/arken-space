#!/usr/bin/env python3
"""Validate the reviewed runtime tar before extraction; no general-purpose archives."""
import hashlib
import json
import pathlib
import sys
import tarfile

archive = pathlib.Path(sys.argv[1])
if archive.stat().st_size > 32 * 1024 * 1024:
    raise ValueError('Runtime archive exceeds bounded size')
with tarfile.open(archive, 'r:gz') as tar:
    members = tar.getmembers()
    paths = {}
    total = 0
    for member in members:
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or '..' in path.parts:
            raise ValueError('Unsafe runtime path')
        key = str(path)
        if not (key == 'usr/local/lib' or key.startswith('usr/local/lib/') or key == 'opt/arken-native' or key.startswith('opt/arken-native/')):
            raise ValueError('Unexpected runtime entry')
        if key in paths or not (member.isfile() or member.isdir() or member.issym()):
            raise ValueError('Duplicate or unsupported runtime entry')
        paths[key] = member
        total += member.size
    if total > 128 * 1024 * 1024:
        raise ValueError('Runtime payload exceeds bounded size')
    for key, member in paths.items():
        for parent in pathlib.PurePosixPath(key).parents:
            if str(parent) in paths and not paths[str(parent)].isdir():
                raise ValueError('Runtime entry has a non-directory ancestor')
        if member.issym():
            link = pathlib.PurePosixPath(member.linkname)
            if link.is_absolute() or '..' in link.parts:
                raise ValueError('Unsafe runtime symlink')
            target = str(pathlib.PurePosixPath(key).parent / link)
            seen = {key}
            while True:
                if target not in paths or target in seen:
                    raise ValueError('Missing or cyclic runtime symlink target')
                seen.add(target)
                end = paths[target]
                if not end.issym():
                    break
                link = pathlib.PurePosixPath(end.linkname)
                if link.is_absolute() or '..' in link.parts:
                    raise ValueError('Unsafe chained runtime symlink')
                target = str(pathlib.PurePosixPath(target).parent / link)
    if 'opt/arken-native/native-runtime-manifest.json' not in paths:
        raise ValueError('Runtime manifest missing')
    manifest_path='opt/arken-native/native-runtime-manifest.json'
    manifest_member=paths[manifest_path]
    if not manifest_member.isfile() or manifest_member.size > 1024 * 1024:
        raise ValueError('Runtime manifest must be a bounded regular file')
    manifest=json.load(tar.extractfile(manifest_member))
    expected=manifest['fileManifest']
    actual={key:member for key,member in paths.items() if not member.isdir() and key!=manifest_path}
    if set(actual)!=set(expected):
        raise ValueError('Runtime payload differs from exact reviewed manifest')
    for key, member in actual.items():
        entry=expected[key]
        if member.isfile():
            if entry['type']!='file' or hashlib.sha256(tar.extractfile(member).read()).hexdigest()!=entry['sha256']:
                raise ValueError('Runtime file hash mismatch')
        elif entry['type']!='symlink' or entry['target']!=member.linkname:
            raise ValueError('Runtime symlink differs from manifest')
    for key, member in paths.items():
        if member.isdir() and not any(payload.startswith(key+'/') for payload in actual):
            raise ValueError('Unexpected empty runtime directory')
