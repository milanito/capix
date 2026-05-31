import { z } from 'zod';
import { capability } from '@capixjs/core';

type Product = {
  id: string;
  name: string;
  category: string;
  priceUsd: number;
  inStock: boolean;
};

const PRODUCTS: Product[] = [
  { id: '1', name: 'Mechanical Keyboard', category: 'peripherals', priceUsd: 149, inStock: true },
  { id: '2', name: 'Ergonomic Mouse', category: 'peripherals', priceUsd: 79, inStock: true },
  { id: '3', name: '4K Monitor', category: 'displays', priceUsd: 599, inStock: false },
  { id: '4', name: 'USB-C Hub', category: 'accessories', priceUsd: 49, inStock: true },
  { id: '5', name: 'Webcam 1080p', category: 'peripherals', priceUsd: 89, inStock: true },
  { id: '6', name: 'Desk Lamp LED', category: 'accessories', priceUsd: 39, inStock: true },
  { id: '7', name: 'Standing Desk', category: 'furniture', priceUsd: 799, inStock: false },
  { id: '8', name: 'Chair Mat', category: 'furniture', priceUsd: 29, inStock: true },
  { id: '9', name: 'Cable Management Kit', category: 'accessories', priceUsd: 19, inStock: true },
  { id: '10', name: 'Monitor Arm', category: 'accessories', priceUsd: 129, inStock: true },
];

const ListProductsInput = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(5),
  category: z.string().optional(),
  inStock: z
    .string()
    .optional()
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
  search: z.string().optional(),
  sortBy: z.enum(['name', 'priceUsd']).default('name'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
});

export const listProducts = capability(
  ListProductsInput,
  ({ page, pageSize, category, inStock, search, sortBy, sortDir, minPrice, maxPrice }) => {
    let results = [...PRODUCTS];

    if (category !== undefined) results = results.filter((p) => p.category === category);
    if (inStock !== undefined) results = results.filter((p) => p.inStock === inStock);
    if (search !== undefined) {
      const q = search.toLowerCase();
      results = results.filter((p) => p.name.toLowerCase().includes(q));
    }
    if (minPrice !== undefined) results = results.filter((p) => p.priceUsd >= minPrice);
    if (maxPrice !== undefined) results = results.filter((p) => p.priceUsd <= maxPrice);

    results.sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      const cmp = typeof av === 'string' ? av.localeCompare(String(bv)) : (av as number) - (bv as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });

    const total = results.length;
    const totalPages = Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;
    const items = results.slice(start, start + pageSize);

    return {
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  },
  'query',
);

const getProduct = capability(
  z.object({ id: z.string() }),
  ({ id }) => {
    const product = PRODUCTS.find((p) => p.id === id);
    if (!product) return null;
    return product;
  },
  'query',
);

export const capabilities = {
  products: { listProducts, getProduct },
};
