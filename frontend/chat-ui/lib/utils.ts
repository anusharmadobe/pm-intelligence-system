import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  // Less than 1 minute
  if (diff < 60000) {
    return 'Just now';
  }

  // Less than 1 hour
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  }

  // Less than 24 hours
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  }

  // Less than 7 days
  if (diff < 604800000) {
    const days = Math.floor(diff / 86400000);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }

  // Format as date
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
}

export function getSourceIcon(source: string): string {
  const icons: Record<string, string> = {
    slack: '💬',
    transcript: '🎙️',
    document: '📄',
    web_scrape: '🌐',
    jira: '🎫',
    default: '📌'
  };

  return icons[source] || icons.default;
}

export function getSourceColor(source: string): string {
  const colors: Record<string, string> = {
    slack: 'bg-purple-100 text-purple-800 border-purple-200',
    transcript: 'bg-blue-100 text-blue-800 border-blue-200',
    document: 'bg-green-100 text-green-800 border-green-200',
    web_scrape: 'bg-orange-100 text-orange-800 border-orange-200',
    jira: 'bg-red-100 text-red-800 border-red-200',
    default: 'bg-gray-100 text-gray-800 border-gray-200'
  };

  return colors[source] || colors.default;
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}
