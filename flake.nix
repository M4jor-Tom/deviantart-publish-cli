{
  description = "Standalone DeviantArt scheduling CLI backed by replay_right";

  inputs = {
    keyfarm.url = "github:M4jor-Tom/replay_right/develop";
    nixpkgs.follows = "keyfarm/nixpkgs";
  };

  outputs = { self, keyfarm, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      source = pkgs.lib.cleanSource ./.;
      toApp = drv: name: { type = "app"; program = "${drv}/bin/${name}"; };
      runner = headless: keyfarm.lib.mkApp {
        inherit pkgs headless;
        cookiesDir = "$DEVIANTART_PROFILE";
        script = "${source}/task.ts";
      };
      headedRunner = runner false;
      headlessRunner = runner true;
      publisher = pkgs.writeShellApplication {
        name = "deviantart-publish-cli";
        runtimeInputs = [ pkgs.nodejs_22 ];
        text = ''
          export DEVIANTART_RUNNER_HEADED=${headedRunner.program}
          export DEVIANTART_RUNNER_HEADLESS=${headlessRunner.program}
          exec node --experimental-strip-types ${source}/cli.ts "$@"
        '';
      };
      browser = pkgs.writeShellApplication {
        name = "deviantart-publish-browser";
        text = ''
          state_dir="$PWD/.deviantart-publish"
          if [ "''${1:-}" = "--state-dir" ]; then
            if [ -z "''${2:-}" ]; then echo "--state-dir requires DIR" >&2; exit 2; fi
            state_dir="$2"
            shift 2
          fi
          if [ "''${1:-}" = "--browser" ]; then
            exec ${keyfarm.apps.${system}.browser.program} "$@"
          fi
          mkdir -p "$state_dir/profile"
          exec ${keyfarm.apps.${system}.browser.program} "$state_dir/profile" "$@"
        '';
      };
      tests = pkgs.runCommand "deviantart-publish-cli-tests" {
        nativeBuildInputs = [ pkgs.nodejs_22 ];
      } ''
        cp -r ${source} ./source
        chmod -R u+w source
        cd source
        node --experimental-strip-types --test
        ${publisher}/bin/deviantart-publish-cli --help >/dev/null
        ${publisher}/bin/deviantart-publish-cli --check-steps
        printf '{"jobs":[]}\n' | ${publisher}/bin/deviantart-publish-cli
        touch "$out"
      '';
    in {
      apps.${system} = {
        default = toApp publisher "deviantart-publish-cli";
        browser = toApp browser "deviantart-publish-browser";
      };
      packages.${system} = { default = publisher; browser = browser; };
      checks.${system}.default = tests;
      devShells.${system}.default = pkgs.mkShell {
        packages = [ pkgs.nodejs_22 ];
        shellHook = ''
          mkdir -p node_modules
          ln -sfn ${pkgs.playwright-driver} node_modules/playwright-core
          export PLAYWRIGHT_FIREFOX=${keyfarm.packages.${system}.keyfarm-browser}/bin/keyfarm-browser
        '';
      };
    };
}
