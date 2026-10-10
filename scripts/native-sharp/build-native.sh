#!/bin/bash
# Source-pinned generic x86-64 sharp runtime. Run inside the native build stage.
set -Eeuo pipefail
test "$(uname -m)" = x86_64
mkdir -p /work/native; cd /work/native
export CFLAGS='-O2 -march=x86-64 -mtune=generic' CXXFLAGS='-O2 -march=x86-64 -mtune=generic'
export PKG_CONFIG_PATH=/usr/local/lib/pkgconfig CMAKE_PREFIX_PATH=/usr/local
fetch() { curl -fL --retry 2 "$1" -o "$3"; printf '%s  %s\n' "$2" "$3" | sha256sum -c -; }
fetch https://github.com/libvips/libvips/releases/download/v8.18.6/vips-8.18.6.tar.xz 3c41e1d5458081bfa4a5bc54e116c46259c75c6760a18027764555632b9dda3e vips.tar.xz
fetch https://github.com/strukturag/libheif/releases/download/v1.23.2/libheif-1.23.2.tar.gz 8bd5d41d19dc84536d118b04774709f244df6104ef66d623dad5fa4650143405 libheif.tar.gz
# Commit-pinned upstream archive; SHA is locally verified provenance, not a publisher signature.
fetch https://codeload.github.com/google/libultrahdr/tar.gz/e5f5a022fe96fc4dc2ee35c19f733a50df807abe 5a7b6347a4a32c6936b81392cd6394250649380202f86c8214042aa645cc385c uhdr.tar.gz
tar xf vips.tar.xz; tar xf libheif.tar.gz; tar xf uhdr.tar.gz
cmake -S libheif-1.23.2 -B heif-build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/usr/local -DCMAKE_INSTALL_LIBDIR=lib -DBUILD_TESTING=OFF -DWITH_EXAMPLES=OFF -DENABLE_PLUGIN_LOADING=OFF -DWITH_EXPERIMENTAL_GAIN_MAP=ON -DWITH_AOM_DECODER=ON -DWITH_AOM_ENCODER=ON -DWITH_DAV1D=ON -DWITH_DAV1D_PLUGIN=OFF -DWITH_LIBDE265=OFF -DWITH_X265=OFF -DWITH_X264=OFF -DWITH_OpenH264_DECODER=OFF -DWITH_LIBSHARPYUV=OFF -DCMAKE_C_FLAGS="$CFLAGS" -DCMAKE_CXX_FLAGS="$CXXFLAGS"
cmake --build heif-build -j2; cmake --install heif-build
cmake -S libultrahdr-e5f5a022fe96fc4dc2ee35c19f733a50df807abe -B uhdr-build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/usr/local -DCMAKE_INSTALL_LIBDIR=lib -DUHDR_BUILD_EXAMPLES=OFF -DUHDR_BUILD_TESTS=OFF -DUHDR_BUILD_DEPS=OFF -DUHDR_ENABLE_INTRINSICS=OFF -DUHDR_ENABLE_INSTALL=ON -DUHDR_ENABLE_HEIF=OFF -DUHDR_MAX_DIMENSION=65500 -DCMAKE_C_FLAGS="$CFLAGS" -DCMAKE_CXX_FLAGS="$CXXFLAGS"
grep -Eq '^UHDR_MAX_DIMENSION:[A-Z]+=65500$' uhdr-build/CMakeCache.txt
cmake --build uhdr-build -j2; cmake --install uhdr-build
meson setup vips-8.18.6/build vips-8.18.6 --prefix=/usr/local --libdir=lib --buildtype=release -Dintrospection=disabled -Dexamples=false -Djpeg=enabled -Dpng=enabled -Dwebp=enabled -Dtiff=enabled -Dheif=enabled -Drsvg=enabled -Dpangocairo=enabled -Dlcms=enabled -Dexif=enabled -Darchive=enabled -Dcgif=enabled -Dimagequant=enabled -Duhdr=enabled -Dcpp_link_args=-Wl,-z,nodelete -Ddeprecated=false -Dcfitsio=disabled -Dfftw=disabled -Djpeg-xl=disabled -Dhighway=disabled -Dorc=disabled -Dmagick=disabled -Dmatio=disabled -Dnifti=disabled -Dopenexr=disabled -Dopenjpeg=disabled -Dopenslide=disabled -Dpdfium=disabled -Dpoppler=disabled -Dquantizr=disabled -Draw=disabled -Dspng=disabled -Dppm=false -Danalyze=false -Dradiance=false
meson compile -C vips-8.18.6/build -j2
meson test -C vips-8.18.6/build --num-processes 2
meson install -C vips-8.18.6/build; ldconfig
readelf -d /usr/local/lib/libvips-cpp.so | grep -q NODELETE
cd /work/sharp-build
npm ci --ignore-scripts
export SHARP_FORCE_GLOBAL_LIBVIPS=1
npm explore sharp -- npm run build
mkdir -p /runtime/usr/local/lib /runtime/opt/arken-native
cp -a /usr/local/lib/libvips*.so* /usr/local/lib/libheif.so* /usr/local/lib/libuhdr.so* /runtime/usr/local/lib/
for dir in /usr/local/lib/vips-modules-*; do
  if [[ -d "$dir" ]]; then mkdir -p "/runtime/usr/local/lib/$(basename "$dir")"; cp -a "$dir/vips-heif.so" "/runtime/usr/local/lib/$(basename "$dir")/"; fi
done
cp node_modules/sharp/src/build/Release/sharp-linux-x64-0.35.4.node /runtime/opt/arken-native/
# Record actual output hashes and pinned recipe; no private inputs or binary enter Git.
sha256sum /work/build-native.sh > /runtime/opt/arken-native/build-recipe.sha256
# Actual manifest below hashes each runtime component; do not self-hash a file while creating it.
python3 - <<'PY'
import pathlib, hashlib, json, subprocess
root=pathlib.Path('/runtime')
libraries={}
for name in ('vips','vips-cpp','heif','uhdr'):
    p=pathlib.Path('/usr/local/lib/lib'+name+'.so').resolve(strict=True)
    assert str(p).startswith('/usr/local/lib/')
    libraries[name]={'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
modules=list(pathlib.Path('/usr/local/lib').glob('vips-modules-*/vips-heif.so'))
assert len(modules)==1
p=modules[0].resolve(strict=True)
libraries['vips-heif']={'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
assert 'NODELETE' in subprocess.check_output(['readelf','-d','/usr/local/lib/libvips-cpp.so'],text=True)
addon=root/'opt/arken-native/sharp-linux-x64-0.35.4.node'
elf=addon.read_bytes()
assert elf[:4]==b'\x7fELF' and elf[4]==2 and elf[5]==1 and int.from_bytes(elf[18:20],'little')==62
for p in root.rglob('*'):
    if p.is_symlink(): assert str(p.resolve(strict=True)).startswith(str(root)+'/')
manifest={'schema':1,'arch':'x64','elfMachine':62,'versions':{'sharp':'0.35.4','vips':'8.18.6','heif':'1.23.2','uhdr':'2.0.2'},'maxDimension':65500,'heifPluginLoading':False,'nativeLibraries':libraries,'addonSha256':hashlib.sha256(elf).hexdigest(),'recipeSha256':hashlib.sha256(pathlib.Path('/work/build-native.sh').read_bytes()).hexdigest(),'sources':{'vips':'3c41e1d5458081bfa4a5bc54e116c46259c75c6760a18027764555632b9dda3e','heif':'8bd5d41d19dc84536d118b04774709f244df6104ef66d623dad5fa4650143405','uhdr':'5a7b6347a4a32c6936b81392cd6394250649380202f86c8214042aa645cc385c'},'aptDependencyVersions':subprocess.check_output(['dpkg-query','-W','-f=${Package}=${Version}\n'],text=True).splitlines()}
file_manifest={}
for payload in root.rglob('*'):
    key=str(payload.relative_to(root))
    if key=='opt/arken-native/native-runtime-manifest.json' or payload.is_dir(): continue
    if payload.is_symlink(): file_manifest[key]={'type':'symlink','target':str(payload.readlink())}
    elif payload.is_file(): file_manifest[key]={'type':'file','sha256':hashlib.sha256(payload.read_bytes()).hexdigest()}
    else: raise ValueError('Unsupported native payload')
manifest['fileManifest']=file_manifest
(root/'opt/arken-native/native-runtime-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
PY
