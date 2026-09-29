// Site settings. No backendUrl = prototype mode with an in-browser demo backend.
window.DSF_CONFIG = {
  backendUrl: 'https://script.google.com/macros/s/AKfycbwFcHj2aQD8EMIVmCM5_ArAPY955VL026js77tdIvrqW3CGdZOVkC-JJ76FoDRj6UFwpA/exec',
  publicUrl: 'https://galanger.github.io/dairyschool-feedback/',
  defaultSeminar: null,      // every link carries ?s=<seminar>
  // Google review link on the thank-you screen: opens Google's own 'Write a review' box for the school's
  // listing (the same listing dairyschool.co.il links to). The Business Profile 'Ask for reviews' short
  // link (https://g.page/r/…/review) works here too. Empty = no ask.
  reviewUrl: 'https://www.google.com/search?q=Israeli+Dairy+School+Alon+Hagalil#lrd=0x151c4cb2bcbc0001:0xf31fb8969249a288,3',
};
