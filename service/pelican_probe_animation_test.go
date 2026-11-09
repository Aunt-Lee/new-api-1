package service

import "testing"

// Temporary verification helper for the animation gate in extractPelicanSVG.
// Deleted after the run; not part of the delivered source tree.
func TestExtractPelicanSVGAnimationGate(t *testing.T) {
	cases := []struct {
		name    string
		raw     string
		wantErr string
	}{
		{"smil animate", `<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"><animate attributeName="r" values="4;8;4" dur="1s" repeatCount="indefinite"/></circle></svg>`, ""},
		{"smil animateTransform", `<svg xmlns="http://www.w3.org/2000/svg"><g><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="1s" repeatCount="indefinite"/></g></svg>`, ""},
		{"mixed case tag", `<svg><AnimateMotion dur="1s" repeatCount="indefinite"/></svg>`, ""},
		{"still image rejected", `<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="4"/></svg>`, "svg is not animated"},
		{"script still rejected first", `<svg><script>alert(1)</script></svg>`, "svg contains unsafe elements"},
		{"foreignObject still rejected", `<svg><foreignObject><div/></foreignObject></svg>`, "svg contains unsafe elements"},
		{"no svg rejected", `here is a bicycle but no markup`, "model response contains no <svg> element"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := extractPelicanSVG(tc.raw)
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				if got == "" {
					t.Fatal("expected svg returned")
				}
				return
			}
			if err == nil || err.Error() != tc.wantErr {
				t.Fatalf("want error %q, got %v", tc.wantErr, err)
			}
		})
	}
}
