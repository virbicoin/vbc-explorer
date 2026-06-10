/**
 * Base Repository
 *
 * Abstract base class providing common database operations.
 * All entity-specific repositories should extend this class.
 *
 * Note: This uses generic types that work with Mongoose 9+
 */

import mongoose, { Model, Document, QueryOptions } from 'mongoose';
import { PaginationInfo } from '../types';

export interface PaginationOptions {
  page?: number;
  limit?: number;
  sort?: Record<string, 1 | -1>;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: PaginationInfo;
}

type FilterType = Record<string, unknown>;
type UpdateType = Record<string, unknown>;

export abstract class BaseRepository<T extends Document> {
  protected model: Model<T>;
  protected collectionName: string;

  constructor(model: Model<T>, collectionName?: string) {
    this.model = model;
    this.collectionName = collectionName || model.collection.name;
  }

  /**
   * Find a single document by ID
   */
  async findById(id: string | mongoose.Types.ObjectId): Promise<T | null> {
    const result = await this.model.findById(id).lean().exec();
    return result as T | null;
  }

  /**
   * Find a single document by filter
   */
  async findOne(filter: FilterType): Promise<T | null> {
    const result = await this.model.findOne(filter).lean().exec();
    return result as T | null;
  }

  /**
   * Find multiple documents by filter
   */
  async find(filter: FilterType = {}, options?: QueryOptions): Promise<T[]> {
    let query = this.model.find(filter);

    if (options?.sort) {
      query = query.sort(options.sort);
    }
    if (options?.limit) {
      query = query.limit(options.limit);
    }
    if (options?.skip) {
      query = query.skip(options.skip);
    }

    const results = await query.lean().exec();
    return results as T[];
  }

  /**
   * Find documents with pagination
   */
  async findPaginated(
    filter: FilterType = {},
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<T>> {
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 20));
    const skip = (page - 1) * limit;
    const sort = options.sort || { _id: -1 };

    const [data, total] = await Promise.all([
      this.model.find(filter).sort(sort).skip(skip).limit(limit).lean().exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return {
      data: data as T[],
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Count documents matching filter
   */
  async count(filter: FilterType = {}): Promise<number> {
    return this.model.countDocuments(filter).exec();
  }

  /**
   * Check if document exists
   */
  async exists(filter: FilterType): Promise<boolean> {
    const result = await this.model.exists(filter);
    return result !== null;
  }

  /**
   * Create a new document
   */
  async create(data: Partial<T>): Promise<T> {
    const doc = new this.model(data);
    const saved = await doc.save();
    return saved as T;
  }

  /**
   * Create multiple documents
   */
  async createMany(data: Partial<T>[]): Promise<T[]> {
    const results = await this.model.insertMany(data);
    return results as unknown as T[];
  }

  /**
   * Update a document by ID
   */
  async updateById(id: string | mongoose.Types.ObjectId, update: UpdateType): Promise<T | null> {
    const result = await this.model.findByIdAndUpdate(id, update, { new: true }).lean().exec();
    return result as T | null;
  }

  /**
   * Update a single document by filter
   */
  async updateOne(filter: FilterType, update: UpdateType): Promise<T | null> {
    const result = await this.model.findOneAndUpdate(filter, update, { new: true }).lean().exec();
    return result as T | null;
  }

  /**
   * Update multiple documents
   */
  async updateMany(filter: FilterType, update: UpdateType): Promise<number> {
    const result = await this.model.updateMany(filter, update).exec();
    return result.modifiedCount;
  }

  /**
   * Delete a document by ID
   */
  async deleteById(id: string | mongoose.Types.ObjectId): Promise<boolean> {
    const result = await this.model.findByIdAndDelete(id).exec();
    return result !== null;
  }

  /**
   * Delete a single document by filter
   */
  async deleteOne(filter: FilterType): Promise<boolean> {
    const result = await this.model.deleteOne(filter).exec();
    return result.deletedCount > 0;
  }

  /**
   * Delete multiple documents
   */
  async deleteMany(filter: FilterType): Promise<number> {
    const result = await this.model.deleteMany(filter).exec();
    return result.deletedCount;
  }

  /**
   * Aggregate pipeline execution
   */
  async aggregate<R = unknown>(pipeline: mongoose.PipelineStage[]): Promise<R[]> {
    return this.model.aggregate(pipeline).exec();
  }

  /**
   * Bulk write operations
   */
  async bulkWrite(
    operations: Parameters<Model<T>['bulkWrite']>[0]
  ): Promise<mongoose.mongo.BulkWriteResult> {
    return this.model.bulkWrite(operations);
  }

  /**
   * Get distinct values for a field
   */
  async distinct(field: string, filter: FilterType = {}): Promise<unknown[]> {
    return this.model.distinct(field, filter).exec();
  }

  /**
   * Direct collection access for complex operations
   */
  getCollection(): mongoose.Collection {
    return this.model.collection;
  }
}
