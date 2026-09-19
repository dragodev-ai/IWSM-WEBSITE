-- ==============================================================================
-- IWSM Website: Supabase Leads Database Schema
-- Run this script in your Supabase Project SQL Editor (supabase.com -> SQL Editor)
-- ==============================================================================

-- 1. Create the 'leads' table
CREATE TABLE IF NOT EXISTS public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    course TEXT DEFAULT 'Gamma Plan — 100 Days Complete Mastery (Flagship)',
    source TEXT DEFAULT 'IWSM Official Website Hero Form',
    status TEXT DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'counselled', 'enrolled', 'closed')),
    notes TEXT,
    ip_address TEXT,
    user_agent TEXT
);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- 3. Policy: Allow anyone (anonymous website visitors) to insert new leads
CREATE POLICY "Allow public anon form submissions" 
ON public.leads 
FOR INSERT 
TO anon 
WITH CHECK (true);

-- 4. Policy: Only authenticated staff / service_role can view or manage leads
CREATE POLICY "Allow authenticated staff to view leads" 
ON public.leads 
FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "Allow authenticated staff to update leads" 
ON public.leads 
FOR UPDATE 
TO authenticated 
USING (true);

-- 5. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON public.leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON public.leads (phone);
CREATE INDEX IF NOT EXISTS idx_leads_status ON public.leads (status);

-- Output confirmation
COMMENT ON TABLE public.leads IS 'Stores incoming student inquiries and admission counselling requests from iwsm.edu.in';
