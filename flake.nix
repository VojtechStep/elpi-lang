{
  description = "Elpi VSCode extension";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
    elpi.url = "git+file:///home/adalbert/Code/Inria/elpi/trace";
  };

  outputs =
    {
      self,
      nixpkgs,
      elpi,
    }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      elpiPkgs = elpi.packages.${system};
    in
    {
      devShells.${system}.default = pkgs.mkShellNoCC {
        name = "elpi-lang";
        packages = [
          pkgs.nodejs
          pkgs.vscodium
          elpiPkgs.elpi
          pkgs.typescript-language-server
        ];
        env.NPM_CONFIG_CACHE = "./.npm_cache";
      };
    };
}
