"use client";

import React from "react";
import { Marquee } from "./3d-testimonails";

// Real Google Reviews from Institute of World Stock Market (IWSM), Gopalpura Bypass, Jaipur
export const googleReviews = [
  {
    name: "Rishabh Mittal",
    location: "Jaipur, Rajasthan",
    handle: "@rishabh_m",
    avatar: "R",
    rating: 5,
    tag: "Options & Psychology",
    text: "Option Buying chhodkar proper setup follow kiya. 7 mahine ke struggle ke baad April me pehla ₹56,000 profit book kiya. Sukoon aur consistency dono mil rahe hain.",
  },
  {
    name: "Anirudh Sharma",
    location: "Jaipur, Rajasthan",
    handle: "@anirudh_sharma",
    avatar: "A",
    rating: 5,
    tag: "Fund Management",
    text: "NEET preparation chhod kar IWSM join kiya. NISM Research Analyst aur Investment Advisor certifications clear kiye, aaj ₹85 Crore ka fund manage kar raha hoon.",
  },
  {
    name: "Deepak Parihar",
    location: "Jodhpur, Rajasthan",
    handle: "@deepak_parihar",
    avatar: "D",
    rating: 5,
    tag: "SMC & Price Action",
    text: "Ek chhoti si capital ke sath start kiya tha. Discipline aur live floor guidance se setup master kiya aur ek single session mein ₹16 Lakh ka profit book hua.",
  },
  {
    name: "Bharti Sharma",
    location: "Jaipur, Rajasthan",
    handle: "@bharti_trader",
    avatar: "B",
    rating: 5,
    tag: "Commodity / MCX",
    text: "Homemaker hoon, subah ghar ke kaamon ke baad shaam ko 5 se 7 baje MCX Natural Gas trade karti hoon. Roz 2 ghante baithkar consistent independent income milti hai.",
  },
  {
    name: "Vikramaditya Rathore",
    location: "Jaipur, Rajasthan",
    handle: "@vikram_rathore",
    avatar: "V",
    rating: 5,
    tag: "Gamma Batch",
    text: "Best stock market institute in Rajasthan. Ashutosh Sir's Option Greeks 2.0 and live market adjustments are completely eye-opening. Truly institutional grade.",
  },
  {
    name: "Sunil Meena",
    location: "Jaipur, Rajasthan",
    handle: "@sunil_m",
    avatar: "S",
    rating: 5,
    tag: "Live Trading Floor",
    text: "Live trading floor culture at IWSM Tower Gopalpura Bypass is top notch. Mentors actually trade live in front of students and explain every order placement.",
  },
  {
    name: "Pooja Choudhary",
    location: "Jaipur, Rajasthan",
    handle: "@pooja_c",
    avatar: "P",
    rating: 5,
    tag: "Technical Analysis",
    text: "Structured 100-day curriculum covers everything from market foundations to smart money concepts without false promises. Transparent mentors and great discipline.",
  },
  {
    name: "Amit Kasliwal",
    location: "Jaipur, Rajasthan",
    handle: "@amit_k",
    avatar: "A",
    rating: 5,
    tag: "NISM Certification",
    text: "SEBI certified mentors who genuinely guide you. No get-rich-quick hype, only mathematical edge, position sizing, and proper risk-to-reward frameworks.",
  },
  {
    name: "Rohit Khandelwal",
    location: "Kota, Rajasthan",
    handle: "@rohit_k",
    avatar: "R",
    rating: 5,
    tag: "Futures & Hedging",
    text: "Came all the way from Kota to attend offline sessions at IWSM. Worth every rupee! The hedging strategies saved my capital during recent high-volatility events.",
  },
];

function GoogleReviewCard({
  name,
  location,
  handle,
  avatar,
  tag,
  text,
}: (typeof googleReviews)[number]) {
  return (
    <div className="w-[300px] shrink-0 rounded-2xl border border-sky-500/20 bg-slate-950/80 p-5 backdrop-blur-xl shadow-xl transition-all duration-300 hover:border-sky-400/50 hover:shadow-sky-500/20">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-amber-600 font-bold text-slate-950 text-sm shadow-md">
            {avatar}
          </div>
          <div>
            <h4 className="text-sm font-semibold text-white leading-tight">{name}</h4>
            <p className="text-xs text-slate-400 flex items-center gap-1">
              <span>{location}</span>
            </p>
          </div>
        </div>
        {/* Google 'G' icon badge */}
        <div className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-slate-300">
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
          </svg>
          <span>5.0</span>
        </div>
      </div>

      {/* Stars and Tag */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex text-amber-400 text-xs">
          ★★★★★
        </div>
        <span className="text-[10px] uppercase font-semibold tracking-wider text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded">
          {tag}
        </span>
      </div>

      <p className="text-xs text-slate-300 leading-relaxed">
        "{text}"
      </p>
    </div>
  );
}

export default function Testimonials3DDemo() {
  const col1 = googleReviews.slice(0, 3);
  const col2 = googleReviews.slice(3, 6);
  const col3 = googleReviews.slice(6, 9);

  return (
    <div className="relative flex h-[620px] w-full items-center justify-center overflow-hidden rounded-2xl border border-sky-500/20 bg-gradient-to-b from-slate-950 via-[#040e22] to-slate-950 [perspective:1000px]">
      {/* 3D Angled Plane */}
      <div
        className="flex flex-row items-center gap-6"
        style={{
          transform:
            "translateX(-60px) translateY(0px) translateZ(-50px) rotateX(24deg) rotateY(-8deg) rotateZ(16deg)",
        }}
      >
        {/* Column 1 - Downwards */}
        <Marquee vertical pauseOnHover repeat={3} className="[--duration:35s]">
          {col1.map((rev, i) => (
            <GoogleReviewCard key={`c1-${i}`} {...rev} />
          ))}
        </Marquee>

        {/* Column 2 - Upwards (Reverse) */}
        <Marquee vertical pauseOnHover reverse repeat={3} className="[--duration:35s]">
          {col2.map((rev, i) => (
            <GoogleReviewCard key={`c2-${i}`} {...rev} />
          ))}
        </Marquee>

        {/* Column 3 - Downwards */}
        <Marquee vertical pauseOnHover repeat={3} className="[--duration:38s]">
          {col3.map((rev, i) => (
            <GoogleReviewCard key={`c3-${i}`} {...rev} />
          ))}
        </Marquee>
      </div>

      {/* Vignette & Gradient Overlays for Seamless Depth */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-slate-950 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-slate-950 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-slate-950 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-slate-950 to-transparent" />
    </div>
  );
}
