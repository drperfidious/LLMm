#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Users/user/Downloads/Xcode-beta.app/Contents/Developer}"
export RNLLAMA_BUILD_FROM_SOURCE="${RNLLAMA_BUILD_FROM_SOURCE:-1}"
export GEM_HOME="$ROOT_DIR/vendor/bundle/ruby/2.6.0"
export GEM_PATH="$GEM_HOME"
export PATH="$GEM_HOME/bin:$PATH"

mkdir -p "$GEM_HOME"

ruby -e 'abort "Expected Ruby 2.6.x, got #{RUBY_VERSION}" unless RUBY_VERSION.start_with?("2.6.")'
ruby -e 'abort "Expected arm64 Ruby, got #{RUBY_PLATFORM}" unless RUBY_PLATFORM.include?("arm64")'

gem_install() {
  local name="$1"
  local version="$2"
  shift 2
  gem install "$name" -v "$version" --no-document "$@"
}

# Pin Ruby 2.6-compatible transitive dependencies. RubyGems otherwise resolves
# newer releases that have dropped Ruby 2.6 support.
gem_install concurrent-ruby 1.3.3
gem_install ruby2_keywords 0.0.5
gem_install drb 2.0.6
gem_install i18n 1.14.8
gem_install minitest 5.24.1
gem_install zeitwerk 2.6.18
gem_install securerandom 0.3.2
gem_install activesupport 6.1.7.10 --conservative

# Force source build. The precompiled x86_64 ffi gem cannot load in arm64 Ruby.
gem_install ffi 1.17.2 --platform ruby

# Match the repo lockfile closely enough for CocoaPods/Xcode project generation.
gem_install ethon 0.15.0
gem_install typhoeus 1.5.0
gem_install xcodeproj 1.25.1
gem_install cocoapods 1.15.2 --conservative

ruby -rffi -e 'puts "ffi #{FFI::VERSION} #{FFI::Platform::ARCH}"'
pod --version
pod install --project-directory=ios
