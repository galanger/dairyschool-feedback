// Site settings. No backendUrl = prototype mode with an in-browser demo backend.
window.DSF_CONFIG = {
  backendUrl: 'https://script.google.com/macros/s/AKfycbwFcHj2aQD8EMIVmCM5_ArAPY955VL026js77tdIvrqW3CGdZOVkC-JJ76FoDRj6UFwpA/exec',
  publicUrl: 'https://galanger.github.io/dairyschool-feedback/',
  defaultSeminar: null,      // every link carries ?s=<seminar>
  // Google's write-a-review link for the school's listing (Place ID derived from the listing ids and checked in
  // Google Maps, 5 Oct 2026): opens the star rating directly for a signed-in Google user. Empty = no ask.
  reviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJAQC8vLJMHBURiKJJkpa4H_M',
};
