// Command genicons generates the MSIX asset images required by
// appxmanifest.xml (Square44x44, Square150x150, Store Logo, etc.) from a
// source PNG, using a small box-filter so downscaling stays reasonably sharp.
//
// It uses only the Go standard library so it can be built and run anywhere the
// Go toolchain is available (e.g. on the Linux packaging host).
package main

import (
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
)

type pair struct {
	name string
	size int
}

var sizes = []pair{
	{"Square30x30Logo.png", 30},
	{"Square44x44Logo.png", 44},
	{"Square71x71Logo.png", 71},
	{"Square150x150Logo.png", 150},
	{"Square310x310Logo.png", 310},
	{"StoreLogo.png", 50},
}

func boxResize(src image.Image, size int) *image.RGBA {
	b := src.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, size, size))
	scale := float64(b.Dx()) / float64(size) // assume square source
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			x0 := int(float64(x) * scale)
			x1 := int(float64(x+1) * scale)
			y0 := int(float64(y) * scale)
			y1 := int(float64(y+1) * scale)
			if x1 > b.Dx() {
				x1 = b.Dx()
			}
			if y1 > b.Dy() {
				y1 = b.Dy()
			}
			var r, g, bl, a uint64
			var n uint64
			for yy := y0; yy < y1; yy++ {
				for xx := x0; xx < x1; xx++ {
					c := color.NRGBAModel.Convert(src.At(xx, yy)).(color.NRGBA)
					r += uint64(c.R)
					g += uint64(c.G)
					bl += uint64(c.B)
					a += uint64(c.A)
					n++
				}
			}
			if n == 0 {
				continue
			}
			dst.Set(x, y, color.NRGBA{
				R: uint8(r / n),
				G: uint8(g / n),
				B: uint8(bl / n),
				A: uint8(a / n),
			})
		}
	}
	return dst
}

func main() {
	in := flag.String("in", "", "source PNG (square)")
	out := flag.String("out", "", "output directory (plain files listed in sizes)")
	flag.Parse()
	if *in == "" || *out == "" {
		fmt.Fprintln(os.Stderr, "usage: genicons -in icon.png -out assets/")
		os.Exit(2)
	}
	f, err := os.Open(*in)
	if err != nil {
		fmt.Fprintln(os.Stderr, "genicons:", err)
		os.Exit(1)
	}
	defer f.Close()
	src, err := png.Decode(f)
	if err != nil {
		fmt.Fprintln(os.Stderr, "genicons: decode:", err)
		os.Exit(1)
	}
	if src.Bounds().Dx() != src.Bounds().Dy() {
		fmt.Fprintln(os.Stderr, "genicons: source image is not square")
		os.Exit(1)
	}
	if src.Bounds().Dx() < 310 {
		fmt.Fprintln(os.Stderr, "genicons: source image must be at least 310x310")
		os.Exit(1)
	}
	if err := os.MkdirAll(*out, 0o755); err != nil {
		fmt.Fprintln(os.Stderr, "genicons:", err)
		os.Exit(1)
	}
	for _, s := range sizes {
		dst := boxResize(src, s.size)
		name := filepath.Join(*out, s.name)
		of, err := os.Create(name)
		if err != nil {
			fmt.Fprintln(os.Stderr, "genicons:", err)
			os.Exit(1)
		}
		if err := png.Encode(of, dst); err != nil {
			of.Close()
			fmt.Fprintln(os.Stderr, "genicons:", err)
			os.Exit(1)
		}
		of.Close()
		fmt.Printf("genicons: wrote %s (%dpx)\n", name, s.size)
	}
}
