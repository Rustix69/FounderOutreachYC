export interface Founder {
  name: string;
  title: string;
  linkedin: string;
  twitter: string;
  emails_found: string[];
  email_guesses: string[];
}

export interface Job {
  title: string;
  url: string;
}

export interface Company {
  name: string;
  slug: string;
  batch?: string;
  website: string;
  one_liner: string;
  industry: string;
  team_size?: number | null;
  launched_at: number;
  // filled in once the company's founders are loaded
  domain?: string;
  linkedin?: string;
  twitter?: string;
  site_emails?: string[];
  job_count?: number;
  jobs?: Job[];
  founders?: Founder[];
  error?: string;
}

export interface BatchInfo {
  batch: string;
  count: number;
}

export type FounderResult = Partial<Company> & { slug: string };

export interface Template {
  my_name: string;
  portfolio: string;
  github: string;
  resume: string;
  subject: string;
  body: string;
}
