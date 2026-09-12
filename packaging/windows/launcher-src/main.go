// Command JobFoundry is the MSIX entry executable for the JobFoundry Windows
// package. It is deliberately tiny: it locates the bundled Node.js runtime and
// the Node-based process manager (launcher.mjs) inside the read-only MSIX
// payload and execs it, forwarding output and the exit code.
//
// Cross-compiled for windows/amd64 on the Linux build host with CGO disabled,
// so the resulting executable has no runtime or DLL dependencies.
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

func main() {
	exe, err := os.Executable()
	if err != nil {
		fmt.Fprintf(os.Stderr, "jobfoundry: cannot resolve executable path: %v\n", err)
		os.Exit(1)
	}
	root := filepath.Dir(exe)

	node := filepath.Join(root, "usr", "lib", "node", "node.exe")
	launcher := filepath.Join(root, "usr", "share", "jobfoundry", "windows", "launcher.mjs")

	for _, p := range []string{node, launcher} {
		if _, err := os.Stat(p); err != nil {
			fmt.Fprintf(os.Stderr, "jobfoundry: missing bundled file: %s\n", p)
			os.Exit(1)
		}
	}

	cmd := exec.Command(node, launcher)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = os.Environ()

	if err := cmd.Run(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			os.Exit(exitErr.ExitCode())
		}
		fmt.Fprintf(os.Stderr, "jobfoundry: failed to run launcher: %v\n", err)
		os.Exit(1)
	}
}