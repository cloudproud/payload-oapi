import type { Config, Option, Field, FieldBase, CollectionConfig, GlobalConfig } from 'payload';
import { OpenAPIV3_1 as v3_1 } from 'openapi-types'

import fs from 'fs'
import path from 'path'

const capitalized = (value: string) => value[0].toUpperCase() + value.slice(1)

// https://payloadcms.com/docs/rest-api/overview
const baseQueryParams: Array<v3_1.ParameterObject> = [
  { in: 'query', name: 'depth', description: 'automatically populates relationships and uploads', schema: { type: 'number' } },
  { in: 'query', name: 'locale', description: 'retrieves document(s) in a specific locale', schema: { type: 'string' } },
  { in: 'query', name: 'fallback-locale', description: 'specifies a fallback locale if no locale value exists', schema: { type: 'string' } },
  { in: 'query', name: 'select', description: 'specifies which fields to include to the result', example: 'select[group][number]=true', schema: { type: 'array', items: { type: 'string' } } },
  { in: 'query', name: 'populate', description: 'specifies which fields to include to the result from populated documents', example: 'populate[pages][text]=true', schema: { type: 'array', items: { type: 'string' } } },
  { in: 'query', name: 'joins', description: 'specifies the custom request for each join field by name of the field', example: 'joins[relatedPosts][sort]=title', schema: { type: 'array', items: { type: 'string' } } },
]

const filterQueryParams: Array<v3_1.ParameterObject> = [
  { in: 'query', name: 'limit', description: 'limits the number of documents returned', schema: { type: 'number' } },
  { in: 'query', name: 'page', description: 'specifies which page to get documents from when used with a limit', schema: { type: 'number' } },
  { in: 'query', name: 'sort', description: 'specifies the field(s) to use to sort the returned documents by', example: 'sort=-createdAt', schema: { type: 'array', items: { type: 'string' } } },
  { in: 'query', name: 'where', description: 'specifies advanced filters to use to query documents', example: 'where[color][equals]=mint', schema: { type: 'array', items: { type: 'string' } } },
]

const defaultCollectionSchemas: Record<string, v3_1.SchemaObject> = {
  'paginationResponse': {
    type: 'object',
    required: ['hasNextPage', 'hasPrevPage', 'limit', 'page', 'nextPage', 'pagingCounter', 'prevPage', 'totalDocs', 'totalPages'],
    properties: {
      hasNextPage: { type: 'boolean', default: false },
      hasPrevPage: { type: 'boolean', default: false },
      limit: { type: 'number' },
      page: { type: 'number' },
      nextPage: { type: 'number' },
      pagingCounter: { type: 'number' },
      prevPage: { type: 'number' },
      totalDocs: { type: 'number' },
      totalPages: { type: 'number' },
    }
  },
  'createResponse': {
    type: 'object',
    required: ['message'],
    properties: {
      message: { type: 'string' },
    }
  },
  'countResponse': {
    type: 'object',
    required: ['totalDocs'],
    properties: {
      totalDocs: { type: 'number' },
    }
  }
}

const componentName = (
  name: string,
  { prefix, suffix }: { suffix?: string; prefix?: string } = {},
): string => {
  if (prefix) {
    name = prefix + capitalized(name)
  }

  if (suffix) {
    name += capitalized(suffix)
  }

  return name
}

type RefOptions = {
  suffix?: string,
  prefix?: string,
}

type ComponentType = 'schemas' | 'responses' | 'requestBodies'

function composeRef(
  mode: 'new' | 'get',
  type: ComponentType,
  name: string,
  options?: RefOptions,
): v3_1.ReferenceObject {
  if (mode === 'new') {
    options = {
      ...options,
      prefix: 'new',
    }
  }

  return {
    $ref: `#/components/${type}/${componentName(name, options)}`,
  }
}

type Options = {
  info?: v3_1.InfoObject,
  output?: string,
}

export const openapi = (options?: Options) => {
  return async (config: Config): Promise<Config> => {
    const document: v3_1.Document = {
      openapi: '3.0.1',
      info: {
        ...options?.info || {},
        title: 'PayloadCMS',
        description: `The backend to build the modern web.`,
        version: '1.0.0',
      },
      tags: [],
      paths: {},
      components: {
        requestBodies: {},
        schemas: {
          ...defaultCollectionSchemas,
        },
        responses: {
          'count': {
            description: 'successful operation',
            content: {
              'application/json': {
                schema: composeRef('get', 'schemas', 'countResponse'),
              }
            }
          }
        },
      }
    }

    for (const global of config.globals || []) {
      document.tags!.push({ name: global.slug })
      generateGlobalOperators(document, global)
      generateCustomEndpointOperators(document, '/api/globals/', global);
    }

    for (const collection of config.collections || []) {
      document.tags!.push({ name: collection.slug })

      if (collection.upload) {
        generateUploadCollectionOperators(document, collection);
      } else {
        generateCollectionOperators(document, collection);
      }

      generateCustomEndpointOperators(document, '/api/', collection);
    }

    if (options?.output) {
      const outputPath = path.resolve(options.output);
      const ext = path.extname(outputPath).toLowerCase();

      switch (ext) {
        case '.json':
          fs.writeFileSync(outputPath, JSON.stringify(document, null, 2));
          break;
        default:
          fs.writeFileSync(outputPath, JSON.stringify(document, null, 2));
      }
    }

    return config
  }
};

function generateCustomEndpointOperators(document: v3_1.Document, base: string, config: CollectionConfig | GlobalConfig) {
  if (!config.endpoints) {
    return
  }

  const { slug } = config

  for (const endpoint of config.endpoints) {
    const path = document.paths![`${base}${slug}${endpoint.path}`] || {}
    const method = endpoint.method.toLowerCase() as v3_1.HttpMethods

    path[method] = {
      tags: [slug],
      responses: {
        200: composeRef('get', 'responses', slug),
      },
      ...endpoint.custom,
    }

    if (method == 'post' || method == 'patch' || method == 'put') {
      path[method]!.requestBody = composeRef('get', 'requestBodies', slug)
    }

    document.paths![`/api/${slug}${endpoint.path}`] = path
  }
}

function generateUploadCollectionOperators(document: v3_1.Document, collection: CollectionConfig) {
  const object = generateObject('get', collection.fields as (Field & FieldBase)[])
  const { slug } = collection

  document.components!.schemas![componentName(slug)] = {
    type: 'object',
    required: [... new Set([
      'id', 'filename', 'filesize', 'focalX', 'focalY', 'mimeType', 'thumbnailURL', 'url', 'height', 'width', 'createdAt', 'updatedAt',
      ...object.required || []
    ])],
    properties: {
      id: { type: 'number' },
      filename: { type: 'string' },
      filesize: { type: 'number' },
      focalX: { type: 'number' },
      focalY: { type: 'number' },
      mimeType: { type: 'string' },
      thumbnailURL: { type: 'string' },
      url: { type: 'string' },
      height: { type: 'number' },
      width: { type: 'number' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      ...object.properties,
    },
  }

  document.components!.requestBodies![componentName(slug)] = {
    description: 'successful operation',
    content: {
      'application/json': {
        schema: composeRef('get', 'schemas', collection.slug),
      }
    }
  }

  document.components!.requestBodies![componentName(slug, { prefix: 'upload' })] = {
    description: 'successful operation',
    content: {
      'multipart/form-data': {
        schema: {
          type: 'object',
          properties: {
            _payload: object,
            file: { type: 'string', format: 'binary' },
          },
        }
      }
    }
  }

  document.components!.responses![componentName(slug)] = {
    description: 'successful operation',
    content: {
      'application/json': {
        schema: composeRef('get', 'schemas', collection.slug),
      }
    }
  }

  document.components!.responses![componentName(slug, { suffix: 'list' })] = {
    description: 'successful operation',
    content: {
      'application/json': {
        schema: {
          allOf: [
            {
              type: 'object',
              required: ['docs'],
              properties: {
                docs: {
                  type: 'array',
                  items: composeRef('get', 'schemas', slug),
                },
              },
            },
            composeRef('get', 'schemas', 'paginationResponse'),
          ],
        }
      }
    }
  }

  document.paths![`/api/${slug}`] = {
    post: {
      operationId: componentName(slug, { prefix: 'upload' }),
      tags: [slug],
      requestBody: composeRef('get', 'requestBodies', slug, { prefix: 'upload' }),
      responses: {
        200: composeRef('get', 'responses', slug),
      }
    },
    get: {
      parameters: [
        ...baseQueryParams,
        ...filterQueryParams,
      ],
      operationId: componentName(slug, { prefix: 'find' }),
      tags: [slug],
      responses: {
        200: composeRef('get', 'responses', slug, { suffix: 'list' }),
      }
    },
  }

  document.paths![`/api/${collection.slug}/{id}`] = {
    parameters: [
      ...baseQueryParams,
      {
        in: 'path',
        name: 'id',
        required: true,
        schema: {
          type: 'string',
        },
      },
    ],
    get: {
      operationId: componentName(slug, { prefix: 'findById' }),
      tags: [slug],
      responses: {
        200: composeRef('get', 'responses', slug),
      }
    },
    patch: {
      operationId: componentName(slug, { prefix: 'updateById' }),
      tags: [slug],
      requestBody: composeRef('get', 'requestBodies', slug),
      responses: {
        200: composeRef('get', 'responses', slug),
      }
    },
    delete: {
      operationId: componentName(slug, { prefix: 'deleteById' }),
      tags: [slug],
      responses: {
        200: composeRef('get', 'responses', slug),
      }
    }
  }

  document.paths![`/api/${collection.slug}/count`] = {
    parameters: baseQueryParams,
    get: {
      operationId: componentName(collection.slug, { prefix: 'count' }),
      tags: [collection.slug],
      responses: {
        200: composeRef('get', 'responses', 'count'),
      }
    },
  }
}

function generateGlobalOperators(document: v3_1.Document, global: GlobalConfig) {
  const object = generateObject('get', global.fields as (Field & FieldBase)[])
  const { slug } = global

  document.components!.schemas![componentName(slug, { prefix: 'global' })] = {
    type: 'object',
    required: [... new Set([
      'id', 'createdAt', 'updatedAt', 'globalType',
      ...object.required || [],
    ])],
    properties: {
      id: { type: 'number' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      globalType: { type: 'string' },
      ...object.properties,
    },
  }

  document.components!.requestBodies![componentName(slug, { prefix: 'global' })] = {
    description: 'successful operation',
    content: {
      'application/json': {
        schema: composeRef('get', 'schemas', slug, { prefix: 'global' }),
      }
    }
  }

  document.components!.responses![componentName(slug, { prefix: 'global' })] = {
    description: 'successful operation',
    content: {
      'application/json': {
        schema: composeRef('get', 'schemas', slug, { prefix: 'global' }),
      }
    }
  }

  document.paths![`/api/globals/${slug}`] = {
    parameters: [
      ...filterQueryParams,
      ...baseQueryParams,
    ],
    get: {
      operationId: componentName(slug, { prefix: 'get' }),
      tags: [slug],
      responses: {
        200: composeRef('get', 'responses', slug, { prefix: 'global' }),
      }
    },
    post: {
      operationId: componentName(slug, { prefix: 'update' }),
      tags: [slug],
      requestBody: composeRef('get', 'requestBodies', slug, { prefix: 'global' }),
      responses: {
        200: composeRef('get', 'responses', slug, { prefix: 'global' }),
      }
    },
  }
}

function generateCollectionOperators(document: v3_1.Document, collection: CollectionConfig) {
  const newObject = generateObject('new', collection.fields as (Field & FieldBase)[])
  const object = generateObject('get', collection.fields as (Field & FieldBase)[])
  const { slug } = collection

  document.components!.schemas![componentName(slug, { prefix: 'new' })] = {
    type: 'object',
    required: [... new Set([
      ...newObject.required || [],
    ])],
    properties: {
      ...newObject.properties,
    },
  }

  document.components!.schemas![componentName(slug)] = {
    type: 'object',
    required: [... new Set([
      'id', 'createdAt', 'updatedAt',
      ...object.required || [],
    ])],
    properties: {
      id: { type: 'number' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      ...object.properties,
    },
  }

  document.components!.requestBodies![componentName(slug, { prefix: 'new' })] = {
    description: 'successful operation',
    content: {
      'application/json': {
        schema: composeRef('get', 'schemas', componentName(collection.slug, { prefix: 'new' })),
      }
    }
  }

  document.components!.requestBodies![componentName(slug)] = {
    description: 'successful operation',
    content: {
      'application/json': {
        schema: composeRef('get', 'schemas', collection.slug),
      }
    }
  }

  document.components!.responses![componentName(slug)] = {
    description: 'successful operation',
    content: {
      'application/json': {
        schema: composeRef('get', 'schemas', collection.slug),
      }
    }
  }

  document.components!.responses![componentName(slug, { prefix: 'new' })] = {
    description: 'successful operation',
    content: {
      'application/json': {
        schema: {
          allOf: [composeRef('get', 'schemas', slug), composeRef('get', 'schemas', 'createResponse')],
        },
      }
    }
  }

  document.components!.responses![componentName(slug, { suffix: 'list' })] = {
    description: 'successful operation',
    content: {
      'application/json': {
        schema: {
          allOf: [
            {
              type: 'object',
              required: ['docs'],
              properties: {
                docs: {
                  type: 'array',
                  items: composeRef('get', 'schemas', slug),
                },
              },
            },
            composeRef('get', 'schemas', 'paginationResponse'),
          ],
        },
      }
    }
  }

  document.paths![`/api/${collection.slug}`] = {
    parameters: [
      ...filterQueryParams,
      ...baseQueryParams,
    ],
    get: {
      operationId: componentName(slug, { prefix: 'find' }),
      tags: [slug],
      responses: {
        200: composeRef('get', 'responses', slug, { suffix: 'list' }),
      }
    },
    post: {
      operationId: componentName(slug, { prefix: 'create' }),
      tags: [slug],
      requestBody: composeRef('get', 'requestBodies', slug, { prefix: 'new' }),
      responses: {
        200: composeRef('get', 'responses', slug),
      }
    },
    patch: {
      operationId: componentName(slug, { prefix: 'update' }),
      tags: [slug],
      requestBody: composeRef('get', 'requestBodies', slug),
      responses: {
        200: composeRef('get', 'responses', slug),
      }
    },
    delete: {
      operationId: componentName(slug, { prefix: 'delete' }),
      tags: [slug],
      responses: {
        200: composeRef('get', 'responses', slug),
      }
    }
  }

  document.paths![`/api/${collection.slug}/{id}`] = {
    parameters: [
      ...baseQueryParams,
      {
        in: 'path',
        name: 'id',
        required: true,
        schema: {
          type: 'string',
        },
      },
    ],
    get: {
      operationId: componentName(slug, { prefix: 'findById' }),
      tags: [slug],
      responses: {
        200: composeRef('get', 'responses', slug),
      }
    },
    patch: {
      operationId: componentName(slug, { prefix: 'updateById' }),
      tags: [slug],
      requestBody: composeRef('get', 'requestBodies', slug),
      responses: {
        200: composeRef('get', 'responses', slug),
      }
    },
    delete: {
      operationId: componentName(slug, { prefix: 'deleteById' }),
      tags: [slug],
      responses: {
        200: composeRef('get', 'responses', slug),
      }
    }
  }

  document.paths![`/api/${collection.slug}/count`] = {
    parameters: baseQueryParams,
    get: {
      operationId: componentName(collection.slug, { prefix: 'count' }),
      tags: [collection.slug],
      responses: {
        200: composeRef('get', 'responses', 'count'),
      }
    },
  }
}

function generateObject(mode: 'new' | 'get', fields: (Field & FieldBase)[]): v3_1.SchemaObject {
  return fields.reduce<v3_1.SchemaObject>((acc, field) => {
    switch (field.type) {
      case 'tabs':
        const result: v3_1.SchemaObject = {
          required: [],
          properties: {},
        }

        for (const tab of field.tabs) {
          if (tab.interfaceName) {
            result.properties![tab.interfaceName] = generateObject(mode, tab.fields as (Field & FieldBase)[])

            continue
          }

          result.properties![field.name] = generateObject(mode, field.tabs.flatMap((tab) => tab.fields as (Field & FieldBase)[]))
        }

        return {
          type: 'object',
          required: acc.required || result.required ? [... new Set([...acc.required || [], ...result.required || []])] : undefined,
          properties: {
            ...acc.properties,
            ...result.properties,
          }
        }
      case 'ui':
        // NOTE: ignore ui field
        return acc
      default:
        if (field.hidden) {
          return acc
        }

        if (mode === 'new' && ['id', 'createdAt', 'updatedAt'].includes(field.name)) {
          return acc
        }

        if (mode === 'new' && field.virtual) {
          return acc
        }

        if (field.type === 'join' && mode === 'new') {
          return acc
        }

        return {
          type: 'object',
          required: acc.required || field.required ? [... new Set(field.required ? [...acc.required || [], field.name] : acc.required)] : undefined,
          properties: {
            ...acc.properties,
            [field.name]: generateField(mode, field),
          }
        }
    }
  }, {})
}

function generateField(mode: 'new' | 'get', field: Field): v3_1.SchemaObject | v3_1.ReferenceObject {
  switch (field.type) {
    case 'text':
      return { type: 'string' }
    case 'textarea':
      return { type: 'string' }
    case 'richText':
      return { type: 'string' }
    case 'number':
      return { type: 'number' }
    case 'array':
      return { type: 'array', items: generateObject(mode, field.fields as (Field & FieldBase)[]) }
    case 'select':
      return { type: 'string', enum: generateOptions(field.options) }
    case 'join':
      if (Array.isArray(field.collection)) {
        if (field.hasMany) {
          return {
            allOf: [
              {
                type: 'object',
                required: ['docs'],
                properties: {
                  docs: {
                    type: 'array',
                    items: {
                      oneOf: field.collection.map((collection) => composeRef(mode, 'schemas', collection))
                    }
                  },
                },
              },
              composeRef('get', 'schemas', 'paginationResponse'),
            ],
          }
        }

        return {
          oneOf: field.collection.map((collection) => composeRef(mode, 'schemas', collection))
        }
      }

      if (field.hasMany) {
        return {
          allOf: [
            {
              type: 'object',
              required: ['docs'],
              properties: {
                docs: {
                  type: 'array',
                  items: composeRef(mode, 'schemas', field.collection),
                },
              },
            },
            composeRef('get', 'schemas', 'paginationResponse'),
          ],
        }
      }

      return composeRef(mode, 'schemas', field.collection)
    case 'blocks':
      return {
        type: 'array',
        items: {
          anyOf: field.blocks.map((block) => generateObject(mode, block.fields as (Field & FieldBase)[]))
        }
      }
    case 'checkbox':
      return { type: 'boolean' }
    case 'code':
      return { type: 'string' }
    case 'collapsible':
    case 'date':
      return { type: 'string', format: 'date-time' }
    case 'email':
      return { type: 'string', format: 'email' }
    case 'group':
      return generateObject(mode, field.fields as (Field & FieldBase)[])
    case 'json':
      return { type: 'object' }
    case 'upload':
      return { type: 'string', description: 'the key of the file uploaded to the upload collection' }
    case 'point':
      // TODO: point format?
      return {}
    case 'radio':
      return { type: 'string', enum: generateOptions(field.options) }
    case 'relationship':
      switch (mode) {
        case 'new':
          if (Array.isArray(field.relationTo) || field.hasMany) {
            return {
              type: 'array',
              items: {
                type: 'string'
              },
            }
          }

          return { type: 'string' }
        case 'get':
          if (Array.isArray(field.relationTo)) {
            if (field.hasMany) {
              return {
                allOf: [
                  {
                    type: 'object',
                    required: ['docs'],
                    properties: {
                      docs: {
                        type: 'array',
                        items: {
                          oneOf: field.relationTo.map((relation) => composeRef(mode, 'schemas', relation))
                        }
                      },
                    },
                  },
                  composeRef('get', 'schemas', 'paginationResponse'),
                ]
              }
            }

            return { oneOf: field.relationTo.map((relation) => composeRef(mode, 'schemas', relation)) }
          }

          if (field.hasMany) {
            return {
              allOf: [
                {
                  type: 'object',
                  required: ['docs'],
                  properties: {
                    docs: {
                      type: 'array',
                      items: composeRef(mode, 'schemas', field.relationTo),
                    },
                  },
                },
                composeRef('get', 'schemas', 'paginationResponse'),
              ],
            }
          }

          return composeRef(mode, 'schemas', field.relationTo)
      }
    case 'row':
      return generateObject(mode, field.fields as (Field & FieldBase)[])
    case 'tabs':
      throw new Error('tabs should be flattened')
    case 'ui':
      throw new Error('ui should be ignored')
  }
}

function generateOptions(options: Option[]): string[] {
  return options.map((option) => typeof option === 'string' ? option : option.value)
}