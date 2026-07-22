// Simple translation loader
const Translation = (function(){
  let lang = 'en';
  let dict = {};
  async function init(userLang){
    lang = userLang === 'fr' ? 'fr' : 'en';
    const res = await fetch(`lang/${lang}.json`);
    dict = await res.json();
    return dict;
  }
  function t(key){
    return dict[key] || key;
  }
  return { init, t };
})();
