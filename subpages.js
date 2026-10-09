const fs = require('fs');
const path = require('path');

const nav = [
  ['/#instagram', 'Instagram', 'nav-instagram'],
  ['/styles/', 'Styles', 'nav-styles'],
  ['/portfolio/', 'Portfolio', 'nav-gallery'],
  ['/videos/', 'Videos', 'nav-videos'],
  ['/kontakt/', 'Kontakt', 'nav-contact'],
];

const styleCards = [
  { id: 'comic', accent: 'pink', color: '#ff8fa3', tag: 'Pop-Art', title: 'Comic & Cartoon Tattoos', text: 'Bunte, ausdrucksstarke Motive im typischen Comic-Stil. Von bekannten Figuren bis zu eigenen Charakteren – mit kräftigen Konturen und leuchtenden Farben.' },
  { id: 'sketch', accent: 'mint', color: '#4ecdc4', tag: 'Minimal', title: 'Sketch Tattoos', text: 'Feine Linienführung mit sketchy Details. Elegant, zeitlos und einfach bäm – ideal für filigrane Motive und lockere Zeichnungen auf der Haut.' },
  { id: 'newschool', accent: 'coral', color: '#ff6b6b', tag: 'Bold', title: 'Newschool Tattoos', text: 'Übertriebene Perspektiven, kräftige Farben und verspielte Motive – der Klassiker moderner Tattoo-Kunst, individuell für dich entworfen.' },
  { id: 'custom', accent: 'lavender', color: '#c084fc', tag: 'Unique', title: 'Custom Design', text: 'Deine Idee, meine Interpretation. Gemeinsam entwickeln wir ein einzigartiges Motiv, das nur dir gehört – vom ersten Entwurf bis zum fertigen Tattoo.' },
];

const pages = {
  '/styles/': {
    key: 'styles',
    title: 'Tattoo Styles in Hamburg: Comic, Sketch, Newschool & Custom | Bubblegum Art',
    description: 'Comic-, Sketch-, Newschool- und Custom-Tattoos im Tattoostudio Bubblegum Art in Hamburg-Eimsbüttel. Alle Styles im Überblick.',
    h1: 'Tattoo Styles in Hamburg',
    intro: 'Comic-, Sketch-, Newschool- und Custom-Tattoos im Tattoostudio in Hamburg-Eimsbüttel. Jeder Style erzählt eine andere Geschichte.',
    crumb: 'Styles',
  },
  '/portfolio/': {
    key: 'gallery',
    title: 'Tattoo Portfolio Hamburg | Arbeiten von Tschiggys Bubblegum Art',
    description: 'Eine Auswahl aktueller Tattoo-Arbeiten aus Hamburg: Comic, Sketch, Newschool und Custom Designs von Tschiggys Bubblegum Art.',
    h1: 'Tattoo Portfolio',
    intro: 'Eine Auswahl aktueller Arbeiten aus dem Studio in Hamburg-Eimsbüttel.',
    crumb: 'Portfolio',
  },
  '/videos/': {
    key: 'videos',
    title: 'Tattoo Videos & Reels Hamburg: Comic, Sketch & Newschool | Bubblegum Art',
    description: 'Tattoo Videos und Reels aus Hamburg-Eimsbüttel: live aus dem Studio von Tschiggy bis zum fertigen Tattoo. Comic, Sketch, Newschool und Custom. Jetzt ansehen.',
    h1: 'Tattoo Videos & Reels',
    intro: 'Live aus dem Studio von Tschiggy bis zum fertigen Tattoo – Comic, Sketch, Newschool und Custom in Bewegung aus Hamburg-Eimsbüttel.',
    crumb: 'Videos',
  },
  '/kontakt/': {
    key: 'contact',
    title: 'Kontakt & Termin | Tattoostudio Bubblegum Art Hamburg',
    description: 'Termin für dein Tattoo in Hamburg anfragen: Tschiggys Bubblegum Art, Eimsbüttler Chaussee 18, 20259 Hamburg. Per E-Mail oder Instagram.',
    h1: 'Kontakt & Termin',
    intro: 'Lass uns über dein nächstes Tattoo sprechen.',
    crumb: 'Kontakt',
  },
};

const mailIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>';
const igIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/></svg>';
const pinIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>';

const extraCss = `
.bw3-page-head { padding-bottom: 0; }
.bw3-page-head h1 { font-family: 'Lobster', cursive; font-size: clamp(36px, 6vw, 56px); font-weight: 400; margin-bottom: 12px; }
.bw3-crumbs { font-size: 13px; color: var(--text-secondary); margin-bottom: 20px; }
.bw3-crumbs a { color: inherit; }
.bw3-page-more { text-align: center; margin-top: 32px; }
.bw3-page-more a { color: var(--bubble-coral); font-weight: 600; }
.bw3-root .bw3-style-card, .bw3-root .bw3-gallery-item, .bw3-root .bw3-contact-card { opacity: 1; transform: none; }
.bw3-root .bw3-gallery-item { aspect-ratio: 1; }
.bw3-root .bw3-gallery-item[hidden] { display: none; }
.bw3-root .bw3-gallery-item img { width: 100%; height: 100%; object-fit: cover; display: block; }
.bw3-video-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 20px; }
.bw3-video-item { margin: 0; }
.bw3-video-item video { width: 100%; aspect-ratio: 9 / 16; object-fit: cover; border-radius: 12px; background: #000; display: block; }
.bw3-video-item figcaption { font-size: 13px; color: var(--text-secondary); margin-top: 8px; }
.bw3-video-item figcaption a { display: block; color: var(--bubble-coral); font-weight: 600; margin-top: 4px; }
.bw3-video-text { max-width: 760px; margin: 40px auto 0; }
.bw3-video-text h2 { font-size: 22px; font-weight: 600; margin-bottom: 12px; color: var(--text-primary); font-family: 'Inter', sans-serif; }
.bw3-video-text p { color: var(--text-secondary); line-height: 1.7; margin-bottom: 12px; }
.bw3-video-text a { color: var(--bubble-coral); font-weight: 600; }
.bw3-page-min { min-height: 100vh; }
.bw3-style-card h2 { font-size: 19px; font-weight: 600; margin-bottom: 10px; color: var(--text-primary); font-family: 'Inter', sans-serif; }
.bw3-contact-card h2 { font-size: 16px; font-weight: 600; margin-bottom: 6px; color: var(--text-primary); font-family: 'Inter', sans-serif; }
`;

function renderSubpage(pathname, ctx) {
  const page = pages[pathname];
  if (!page) return null;
  const { siteUrl, escape, media, css } = ctx;
  const url = `${siteUrl}${pathname}`;
  const logo = `${siteUrl}/storage/img/0980fd88548cae3e17e0f577e559e2cfa6710bad.webp`;
  const e = escape;

  let body = '';
  const graphExtra = [];

  if (page.key === 'styles') {
    body = `<div class="bw3-styles-grid">${styleCards.map((card) => `
      <article class="bw3-style-card" id="${card.id}" style="--accent: var(--bubble-${card.accent}); --tag-bg: ${card.color}1f; --tag-color: ${card.color};">
        <h2>${e(card.title)}</h2>
        <p>${e(card.text)}</p>
        <span class="bw3-style-tag">${e(card.tag)}</span>
      </article>`).join('')}</div>
      <p class="bw3-page-more"><a href="/portfolio/">Beispiele im Portfolio ansehen →</a> · <a href="/kontakt/">Termin anfragen →</a></p>`;
  } else if (page.key === 'gallery') {
    const items = media.filter((item) => item.isTattooPortfolio);
    body = items.length
      ? `<div class="bw3-gallery" id="galleryGrid">${items.map((item, index) => {
        const altText = e(item.altText || 'Tattoo von Tschiggys Bubblegum Art');
        const first = index < 12;
        return `<a class="bw3-gallery-item" href="${e(item.imageUrl)}"${first ? '' : ' hidden'}><img src="${e(item.thumbnailUrl || item.imageUrl)}" alt="${altText}" width="320" height="320" ${index < 4 ? 'fetchpriority="high"' : first ? '' : 'loading="lazy"'} decoding="async"><div class="bw3-gallery-caption">${altText}</div></a>`;
      }).join('')}</div><div class="bw3-pagination" id="galleryPagination" aria-label="Portfolio-Seiten"></div>`
      : '<p class="bw3-section-sub">Aktuelle Arbeiten findest du auf <a href="https://instagram.com/tschiggys" rel="noopener noreferrer">Instagram</a>.</p>';
    body += '<p class="bw3-page-more"><a href="/styles/">Alle Tattoo Styles →</a> · <a href="/kontakt/">Termin anfragen →</a></p>';
    if (items.length) {
      graphExtra.push({
        '@type': 'ImageGallery',
        '@id': `${url}#gallery`,
        url,
        name: 'Tattoo Portfolio Hamburg',
        about: { '@id': `${siteUrl}/#studio` },
        image: items.slice(0, 24).map((item) => ({
          '@type': 'ImageObject',
          contentUrl: `${siteUrl}${item.imageUrl}`,
          thumbnailUrl: `${siteUrl}${item.thumbnailUrl || item.imageUrl}`,
          name: item.altText || 'Tattoo von Tschiggys Bubblegum Art',
          caption: item.altText || undefined,
          uploadDate: item.timestamp || undefined,
          creator: { '@type': 'Organization', name: 'Tschiggy | Bubblegum art Tattoo Hamburg' },
          copyrightNotice: '© Tschiggy | Bubblegum art Tattoo Hamburg',
          creditText: 'Tschiggys Bubblegum Art Tattoo',
        })),
      });
    }
  } else if (page.key === 'videos') {
    const items = media.filter((item) => item.videoUrl);
    body = items.length
      ? `<div class="bw3-video-grid">${items.map((item) => {
        const altText = e(item.altText || 'Tattoo-Reel von Tschiggys Bubblegum Art');
        return `<figure class="bw3-video-item"><video controls preload="none" playsinline poster="${e(item.thumbnailUrl || item.imageUrl)}" src="${e(item.videoUrl)}"></video><figcaption>${altText}</figcaption></figure>`;
      }).join('')}</div>`
      : '<p class="bw3-section-sub">Aktuelle Reels findest du auf <a href="https://instagram.com/tschiggys" rel="noopener noreferrer">Instagram</a>.</p>';
    body += `<div class="bw3-video-text">
      <h2>Tattoo Reels aus dem Studio in Hamburg</h2>
      <p>Von Live-Momenten direkt von Tschiggy aus dem Studio in Hamburg-Eimsbüttel, nahe der Sternschanze, bis zum fertig gestochenen Tattoo: Hier siehst du alles in Bewegung. Beim Stechen, beim Entwurf, im Studioalltag und am Ende das Ergebnis – bunte Comic- und Cartoon-Tattoos, feine Sketch-Linien, verspielte Newschool-Designs und Custom-Tattoos nach deiner Idee.</p>
      <p>Die Reels zeigen, wie die Farben und Linien auf der Haut wirken, und geben dir einen echten Eindruck vom Stil, bevor du dein Tattoo in Hamburg planst.</p>
      <p>Mehr Motive findest du im <a href="/portfolio/">Portfolio</a>, alle Stilrichtungen auf der Seite <a href="/styles/">Tattoo Styles</a>. Du hast schon eine Idee? Dann <a href="/kontakt/">frag deinen Termin an</a> – deine Idee, meine Interpretation.</p>
    </div>
    <p class="bw3-page-more"><a href="/portfolio/">Zum Portfolio →</a> · <a href="/styles/">Tattoo Styles →</a> · <a href="/kontakt/">Termin anfragen →</a></p>`;
    items.forEach((item) => {
      graphExtra.push({
        '@type': 'VideoObject',
        name: item.altText || 'Tattoo-Reel von Tschiggys Bubblegum Art',
        description: item.altText || page.description,
        thumbnailUrl: `${siteUrl}${item.thumbnailUrl || item.imageUrl}`,
        contentUrl: `${siteUrl}${item.videoUrl}`,
        uploadDate: item.timestamp || undefined,
        creator: { '@type': 'Organization', name: 'Tschiggy | Bubblegum art Tattoo Hamburg' },
      });
    });
  } else {
    body = `<div class="bw3-contact-grid">
      <a class="bw3-contact-card" href="mailto:tschiggys@bubblegumart.de"><div class="bw3-contact-icon" style="--icon-bg: rgba(78,205,196,0.12); --icon-color: #4ecdc4;">${mailIcon}</div><h2>E-Mail</h2><p>tschiggys@bubblegumart.de</p></a>
      <a class="bw3-contact-card" href="https://instagram.com/tschiggys" target="_blank" rel="noopener noreferrer"><div class="bw3-contact-icon" style="--icon-bg: rgba(192,132,252,0.12); --icon-color: #c084fc;">${igIcon}</div><h2>Instagram</h2><p>@tschiggys</p></a>
      <a class="bw3-contact-card" href="https://www.google.com/maps/search/?api=1&amp;query=Eimsb%C3%BCttler+Chaussee+18%2C+20259+Hamburg" target="_blank" rel="noopener noreferrer"><div class="bw3-contact-icon" style="--icon-bg: rgba(255,143,163,0.12); --icon-color: #ff8fa3;">${pinIcon}</div><h2>Studio</h2><p>Eimsbüttler Chaussee 18<br>20259 Hamburg</p></a>
    </div>
    <p class="bw3-page-more"><a href="/styles/">Tattoo Styles →</a> · <a href="/portfolio/">Portfolio →</a></p>`;
  }

  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': page.key === 'contact' ? 'ContactPage' : page.key === 'gallery' || page.key === 'videos' ? 'CollectionPage' : 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: page.h1,
        description: page.description,
        inLanguage: 'de-DE',
        isPartOf: { '@id': `${siteUrl}/#website` },
        about: { '@id': `${siteUrl}/#studio` },
        breadcrumb: { '@id': `${url}#breadcrumb` },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Startseite', item: `${siteUrl}/` },
          { '@type': 'ListItem', position: 2, name: page.crumb, item: url },
        ],
      },
      ...graphExtra,
    ],
  };
  const jsonLd = JSON.stringify(graph).replace(/</g, '\\u003c');

  const navHtml = nav.map(([href, label, id]) => `<li><a href="${href}" id="${id}"${href === pathname ? ' class="active" aria-current="page"' : ''}>${label}</a></li>`).join('');
  const ogImage = media[0] ? `${siteUrl}${media[0].imageUrl}` : logo;

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${e(page.title)}</title>
<meta name="description" content="${e(page.description)}">
<link rel="canonical" href="${url}">
<link rel="icon" href="/favicon.ico" sizes="any">
<meta property="og:type" content="website">
<meta property="og:locale" content="de_DE">
<meta property="og:title" content="${e(page.title)}">
<meta property="og:description" content="${e(page.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${e(ogImage)}">
<meta property="og:site_name" content="Tschiggys Bubblegum Art Tattoo">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${jsonLd}</script>
<style>${css}${extraCss}</style>
</head>
<body>
<div class="bw3-root bw3-page-min" id="bw3Root">
  <nav class="bw3-nav">
    <a class="bw3-nav-logo" href="/" aria-label="Bubblegum Art Tattoo, Startseite">bubblegum<span>art</span></a>
    <ul class="bw3-nav-links">${navHtml}</ul>
    <div class="bw3-nav-right">
      <button class="bw3-theme-toggle" id="themeToggle" title="Light / Dark" aria-label="Dark Mode aktivieren" aria-pressed="false"><span id="themeIcon">&#127769;</span></button>
      <a class="bw3-nav-cta" href="/kontakt/">Termin buchen</a>
    </div>
  </nav>
  <main>
    <section class="bw3-section bw3-page-head">
      <nav class="bw3-crumbs" aria-label="Brotkrumen"><a href="/">Startseite</a> › ${e(page.crumb)}</nav>
      <h1>${e(page.h1)}</h1>
      <p class="bw3-section-sub">${e(page.intro)}</p>
    </section>
    <section class="bw3-section">${body}</section>
  </main>
  <footer class="bw3-footer">
    <p>&#169; 2026 Tschiggys Bubblegum Art Tattoo · Eimsbüttler Chaussee 18, 20259 Hamburg</p>
    <p><a href="/">Start</a> · <a href="/styles/">Styles</a> · <a href="/portfolio/">Portfolio</a> · <a href="/kontakt/">Kontakt</a> · <a href="/impressum/">Impressum</a> · <a href="/datenschutz/">Datenschutz</a></p>
  </footer>
  ${page.key === 'gallery' ? `<div class="bw3-lightbox" id="lightbox" role="dialog" aria-modal="true" aria-label="Bildansicht" aria-hidden="true">
    <button type="button" class="bw3-lightbox-close" id="lightboxClose" aria-label="Schließen">&#215;</button>
    <img id="lightboxImg" alt="">
  </div>` : ''}
</div>
<script>
(function(){
  var root=document.getElementById('bw3Root'),icon=document.getElementById('themeIcon'),btn=document.getElementById('themeToggle');
  var h=new Date().getHours(),dark=h>=20||h<7;
  function apply(){if(dark)root.setAttribute('data-theme','dark');else root.removeAttribute('data-theme');icon.textContent=dark?'\\u2600':'\\uD83C\\uDF19';btn.setAttribute('aria-label',dark?'Light Mode aktivieren':'Dark Mode aktivieren');btn.setAttribute('aria-pressed',String(dark));}
  btn.addEventListener('click',function(){dark=!dark;apply();});
  apply();
})();
${page.key === 'gallery' ? `(function(){
  var grid=document.getElementById('galleryGrid'),nav=document.getElementById('galleryPagination');
  if(!grid||!nav)return;
  var items=Array.prototype.slice.call(grid.children),size=12,current=1,pages=Math.ceil(items.length/size);
  for(var i=items.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=items[i];items[i]=items[j];items[j]=t;}
  items.forEach(function(el){grid.appendChild(el);});
  function btn(label,page,opts){var b=document.createElement('button');b.type='button';b.textContent=label;if(opts&&opts.disabled)b.disabled=true;if(opts&&opts.active){b.className='active';b.setAttribute('aria-current','page');}b.addEventListener('click',function(){current=page;render();grid.scrollIntoView({behavior:'smooth',block:'start'});});return b;}
  function render(){
    items.forEach(function(el,i){el.hidden=i<(current-1)*size||i>=current*size;});
    nav.textContent='';
    if(pages<=1)return;
    nav.appendChild(btn('\\u2190',current-1,{disabled:current===1}));
    for(var p=1;p<=pages;p++){
      if(p===1||p===pages||Math.abs(p-current)<=1){nav.appendChild(btn(String(p),p,{active:p===current}));}
      else if(Math.abs(p-current)===2){var s=document.createElement('span');s.className='ellipsis';s.textContent='\\u2026';nav.appendChild(s);}
    }
    nav.appendChild(btn('\\u2192',current+1,{disabled:current===pages}));
  }
  render();
  var lb=document.getElementById('lightbox'),lbImg=document.getElementById('lightboxImg'),lbClose=document.getElementById('lightboxClose'),opener=null;
  function closeLb(){lb.classList.remove('active');lb.setAttribute('aria-hidden','true');lbImg.removeAttribute('src');if(opener)opener.focus();}
  grid.addEventListener('click',function(ev){
    var a=ev.target.closest&&ev.target.closest('.bw3-gallery-item');
    if(!a||ev.metaKey||ev.ctrlKey||ev.shiftKey||ev.button)return;
    ev.preventDefault();
    var img=a.querySelector('img');
    opener=a;
    lbImg.src=a.getAttribute('href');
    lbImg.alt=img?img.alt:'';
    lb.classList.add('active');
    lb.setAttribute('aria-hidden','false');
    lbClose.focus();
  });
  lb.addEventListener('click',closeLb);
  lbClose.addEventListener('click',function(ev){ev.stopPropagation();closeLb();});
  document.addEventListener('keydown',function(ev){if(ev.key==='Escape'&&lb.classList.contains('active'))closeLb();});
})();` : ''}
</script>
</body>
</html>`;
}

function extractCss() {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  return html.match(/<style>([\s\S]*?)<\/style>/)[1];
}

module.exports = { pages, renderSubpage, extractCss };
