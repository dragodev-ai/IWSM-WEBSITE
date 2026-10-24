/**
 * IWSM "Who Is This Course For?" (Eligibility & Personas) Showcase Handler
 */

(function initIWSMPersonas() {
  const personasData = {
    'working-professionals': {
      badge: '💼 Evening & Weekend Trading Blueprint',
      title: 'Working Professionals & Corporate Executives',
      desc: 'You don’t have to quit your 9-to-5 or sit glued to screens all day. Our institutional mentors teach high-probability positional swing setups and non-directional index option selling that require just 30 to 45 minutes of evening planning.',
      timeTitle: 'Time Commitment',
      timeText: '30–45 Mins Daily (Post-market review & morning pre-market plan)',
      stratTitle: 'Trading Framework',
      stratText: 'Positional Swing Breakouts, Index Options Selling & Zero-Screen Delivery',
      outTitle: 'Real Outcome',
      outText: 'Generate a disciplined second income stream without jeopardizing corporate career focus.',
      ctaText: 'Explore Evening & Weekend Batches →',
      courseParam: 'Working Professionals Mentorship',
      chipLabel: '● Flexible Evening Schedule',
      chipTag: 'Index & Swing Focus',
      imgSrc: 'assets/personas/working-professionals.jpg',
      imgAlt: 'Corporate professional learning stock market trading after office hours'
    },
    'housewives': {
      badge: '🏡 Financial Autonomy & Family Wealth',
      title: 'Housewives, Homemakers & Women Wealth Builders',
      desc: 'Transform household savings into inflation-beating wealth. Learn in a supportive, zero-intimidation environment with step-by-step guidance on risk management, equity delivery, and safe dividend compounding from home.',
      timeTitle: 'Time Commitment',
      timeText: '1–2 Hours Mid-Day (10:30 AM to 1:00 PM quiet market hours)',
      stratTitle: 'Trading Framework',
      stratText: 'Quality Cash Equity Delivery, Blue-chip SIP Baskets & Capital Protection',
      outTitle: 'Real Outcome',
      outText: 'Achieve complete personal financial independence and grow family wealth safely.',
      ctaText: 'Join Women Wealth Masterclass →',
      courseParam: 'Homemakers Trading Program',
      chipLabel: '● Learn from Home Comfort',
      chipTag: 'Capital Safety First',
      imgSrc: 'assets/personas/housewives.jpg',
      imgAlt: 'Independent woman learner building financial knowledge from home'
    },
    'students': {
      badge: '🎓 Career Accelerator & Market Edge',
      title: 'College Students & Aspiring Finance Leaders',
      desc: 'Build practical, resume-defining market expertise before graduation. Master institutional Smart Money Concepts (SMC), Price Action, algorithmic systems, and NISM examination prep to launch careers in research and proprietary trading.',
      timeTitle: 'Time Commitment',
      timeText: 'Flexible College Hours & Weekend Trading Floor Simulations',
      stratTitle: 'Trading Framework',
      stratText: 'Price Action Foundations, SMC/ICT Liquidity Order Blocks & Algorithmic Logic',
      outTitle: 'Real Outcome',
      outText: 'Qualify for NISM certifications, build an auditable track record, and crack prop desk evaluations.',
      ctaText: 'Enroll in Student Career Track →',
      courseParam: 'Student Trader Fast-Track',
      chipLabel: '● Career-Ready Certifications',
      chipTag: 'Student Discount Available',
      imgSrc: 'assets/personas/students.jpg',
      imgAlt: 'Ambitious college students learning algorithmic and price action trading'
    },
    'investors': {
      badge: '📈 Long-Term Portfolio Compounding',
      title: 'Long-Term Investors & Capital Allocators',
      desc: 'Stop relying on random tips and mutual fund underperformance. Learn how institutional hedge funds evaluate balance sheets, detect promoter red flags, spot sector rotations, and hedge equity portfolios with index options.',
      timeTitle: 'Time Commitment',
      timeText: 'Weekly & Monthly Macro Portfolio Review (Zero Day-Trading Stress)',
      stratTitle: 'Trading Framework',
      stratText: 'Fundamental Valuation, Multibagger Screening, Cash Flow Auditing & Portfolio Hedging',
      outTitle: 'Real Outcome',
      outText: 'Compound personal portfolios at institutional CAGR with robust downside risk protection.',
      ctaText: 'Master Institutional Investing →',
      courseParam: 'Long-Term Wealth Allocation',
      chipLabel: '● Deep Value & Multibaggers',
      chipTag: 'Hedging Strategies',
      imgSrc: 'assets/personas/investors.jpg',
      imgAlt: 'Analytical stock market investor reviewing fundamental equity valuation'
    },
    'scalpers': {
      badge: '⚡ High-Velocity Intraday Precision',
      title: 'Intraday Scalpers & Momentum Traders',
      desc: 'Speed and execution discipline are everything. Master 1-minute and 3-minute order flow, Delta & Gamma option Greeks, liquidity absorption, and dynamic trailing stop-losses engineered for quick intraday index moves.',
      timeTitle: 'Time Commitment',
      timeText: 'Morning Volatility Window (9:15 AM – 11:30 AM) or Afternoon Reversals',
      stratTitle: 'Trading Framework',
      stratText: 'Order Flow Delta, NIFTY/BANKNIFTY Scalping, VWAP Trailing & 1:2+ R:R Matrix',
      outTitle: 'Real Outcome',
      outText: 'Quick, disciplined execution with strictly managed drawdown; zero emotional revenge-trading.',
      ctaText: 'Master Intraday Scalping →',
      courseParam: 'Intraday Scalping Mastery',
      chipLabel: '● Fast Order Execution',
      chipTag: 'Strict 1:2+ R:R',
      imgSrc: 'assets/personas/scalpers.jpg',
      imgAlt: 'Intense day trader executing fast momentum scalping setups'
    },
    'traders': {
      badge: '📊 Systematic Swing & Positional Flow',
      title: 'Full-Time & Part-Time Swing Traders',
      desc: 'Upgrade from haphazard retail trading to a systematic, rule-based approach. Learn institutional market structure, multi-timeframe confirmation, liquidity mapping, and robust position sizing across market regimes.',
      timeTitle: 'Time Commitment',
      timeText: 'Adaptable (Full-time market hours or end-of-day positional tracking)',
      stratTitle: 'Trading Framework',
      stratText: 'Trend Continuation, Options Spread Hedging, Multi-Asset Coverage (Equity & Derivatives)',
      outTitle: 'Real Outcome',
      outText: 'Consistent risk-adjusted monthly returns with an institutional playbook and trading journal.',
      ctaText: 'Unlock Full-Time Playbook →',
      courseParam: 'Systematic Swing Trading',
      chipLabel: '● Multi-Timeframe Playbook',
      chipTag: 'Institutional Systems',
      imgSrc: 'assets/personas/traders.jpg',
      imgAlt: 'Experienced trader analyzing technical charts across multiple timeframes'
    },
    'entrepreneurs': {
      badge: '🏢 Corporate Treasury & Wealth Protection',
      title: 'Business Owners & Entrepreneurs',
      desc: 'Put idle corporate liquidity to work while safeguarding business capital. Learn currency and commodity hedging for import/export risks, working capital deployment, and tax-efficient surplus management.',
      timeTitle: 'Time Commitment',
      timeText: 'Quarterly Strategic Rebalancing & Real-Time Hedging Checkpoints',
      stratTitle: 'Trading Framework',
      stratText: 'Treasury Capital Yield, Currency USD/INR Hedging, Commodity Derivatives & Defensive Spreads',
      outTitle: 'Real Outcome',
      outText: 'Shield business margins from raw-material and forex volatility while maximizing surplus liquidity.',
      ctaText: 'Consult on Treasury Strategies →',
      courseParam: 'Entrepreneurs Treasury Hedging',
      chipLabel: '● Corporate Wealth & Hedging',
      chipTag: 'Business Treasury',
      imgSrc: 'assets/personas/entrepreneurs.jpg',
      imgAlt: 'Business owner managing corporate treasury and market risk hedging'
    }
  };

  function setupPersonasSection() {
    const tabsContainer = document.getElementById('persona-tabs');
    if (!tabsContainer) return;

    const tabs = Array.from(tabsContainer.querySelectorAll('.persona-tab-btn'));
    const badgeEl = document.getElementById('persona-badge');
    const titleEl = document.getElementById('persona-title');
    const descEl = document.getElementById('persona-desc');
    const timeTitleEl = document.getElementById('persona-time-title');
    const timeTextEl = document.getElementById('persona-time-text');
    const stratTitleEl = document.getElementById('persona-strat-title');
    const stratTextEl = document.getElementById('persona-strat-text');
    const outTitleEl = document.getElementById('persona-out-title');
    const outTextEl = document.getElementById('persona-out-text');
    const ctaBtn = document.getElementById('persona-cta-btn');
    const chipLabelEl = document.getElementById('persona-chip-label');
    const chipTagEl = document.getElementById('persona-chip-tag');
    const imgEl = document.getElementById('persona-main-img');

    function selectPersona(key, animate = false) {
      const data = personasData[key];
      if (!data) return;

      // Update tabs active state
      tabs.forEach(tab => {
        const isMatch = tab.getAttribute('data-persona') === key;
        tab.classList.toggle('active', isMatch);
        tab.setAttribute('aria-selected', isMatch);
      });

      const contentPanel = document.querySelector('.persona-content-panel');
        if (badgeEl) badgeEl.textContent = data.badge;
        if (titleEl) titleEl.textContent = data.title;
        if (descEl) descEl.textContent = data.desc;
        if (timeTitleEl) timeTitleEl.textContent = data.timeTitle;
        if (timeTextEl) timeTextEl.textContent = data.timeText;
        if (stratTitleEl) stratTitleEl.textContent = data.stratTitle;
        if (stratTextEl) stratTextEl.textContent = data.stratText;
        if (outTitleEl) outTitleEl.textContent = data.outTitle;
        if (outTextEl) outTextEl.textContent = data.outText;
        if (chipLabelEl) chipLabelEl.textContent = data.chipLabel;
        if (chipTagEl) chipTagEl.textContent = data.chipTag;

        if (ctaBtn) {
          ctaBtn.textContent = data.ctaText;
          ctaBtn.onclick = (e) => {
            if (window.enquireForCourse) {
              window.enquireForCourse(data.courseParam);
            }
          };
        }

      if (imgEl) { imgEl.src = data.imgSrc; imgEl.alt = data.imgAlt; }
      // Immediate content update avoids stale tabs when visitors switch quickly.
      [contentPanel, imgEl].filter(Boolean).forEach(el => el.getAnimations().forEach(a => a.cancel()));
      if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        [contentPanel, imgEl].filter(Boolean).forEach(el => {
          el.getAnimations().forEach(a => a.cancel());
          el.animate([{opacity:.5,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],
            {duration:200,easing:'cubic-bezier(0.23,1,0.32,1)'});
        });
      }
    }

    tabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        e.preventDefault();
        const personaKey = tab.getAttribute('data-persona');
        selectPersona(personaKey, e.detail > 0);
      });
    });

    // Initialize first tab
    selectPersona('working-professionals');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupPersonasSection);
  } else {
    setupPersonasSection();
  }
})();
