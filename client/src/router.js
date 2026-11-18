export const go = (r) => {
  window.location.hash = r ? `/${r}` : '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
};
