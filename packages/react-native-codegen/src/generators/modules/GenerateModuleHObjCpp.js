/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 * @format
 */

'use strict';

import type {
  SchemaType,
  FunctionTypeAnnotationParam,
  FunctionTypeAnnotationReturn,
  ObjectParamTypeAnnotation,
  ObjectTypeAliasTypeShape,
} from '../../CodegenSchema';

const {
  translateObjectsForStructs,
  capitalizeFirstLetter,
  getNamespacedStructName,
} = require('./ObjCppUtils/GenerateStructs');

const {getTypeAliasTypeAnnotation} = require('./ObjCppUtils/Utils');

type FilesOutput = Map<string, string>;

const moduleTemplate = `    /**
    * ObjC++ class for module '::_MODULE_NAME_::'
    */
    class JSI_EXPORT Native::_MODULE_NAME_::SpecJSI : public ObjCTurboModule {
    public:
      Native::_MODULE_NAME_::SpecJSI(const ObjCTurboModule::InitParams &params);
    };`;

const protocolTemplate = `::_STRUCTS_::

@protocol Native::_MODULE_NAME_::Spec <RCTBridgeModule, RCTTurboModule>
::_MODULE_PROPERTIES_::
@end
`;

const callbackArgs = prop =>
  prop.typeAnnotation.returnTypeAnnotation.type ===
  'GenericPromiseTypeAnnotation'
    ? `${
        prop.typeAnnotation.params.length === 0 ? '' : '\n   resolve'
      }:(RCTPromiseResolveBlock)resolve
   reject:(RCTPromiseRejectBlock)reject`
    : '';

const template = `
/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ${'@'}generated by codegen project: GenerateModuleHObjCpp.js
 */

#ifndef __cplusplus
#error This file must be compiled as Obj-C++. If you are importing it, you must change your file extension to .mm.
#endif

#import <vector>

#import <Foundation/Foundation.h>

#import <folly/Optional.h>

#import <RCTRequired/RCTRequired.h>
#import <RCTTypeSafety/RCTConvertHelpers.h>
#import <RCTTypeSafety/RCTTypedModuleConstants.h>

#import <React/RCTBridgeModule.h>
#import <React/RCTCxxConvert.h>
#import <React/RCTManagedPointer.h>

#import <ReactCommon/RCTTurboModule.h>

::_PROTOCOLS_::

namespace facebook {
  namespace react {
::_MODULES_::
  } // namespace react
} // namespace facebook
`;

type ObjectForGeneratingStructs = $ReadOnly<{|
  name: string,
  object: $ReadOnly<{|
    type: 'ObjectTypeAnnotation',
    properties: $ReadOnlyArray<ObjectParamTypeAnnotation>,
  |}>,
|}>;

const constants = `- (facebook::react::ModuleConstants<JS::Native::_MODULE_NAME_::::Constants::Builder>)constantsToExport;
- (facebook::react::ModuleConstants<JS::Native::_MODULE_NAME_::::Constants::Builder>)getConstants;`;

function translatePrimitiveJSTypeToObjCType(
  param: FunctionTypeAnnotationParam,
  createErrorMessage: (typeName: string) => string,
  aliases: $ReadOnly<{[aliasName: string]: ObjectTypeAliasTypeShape, ...}>,
) {
  const {nullable, typeAnnotation} = param;

  function wrapIntoNullableIfNeeded(generatedType: string) {
    return nullable ? `${generatedType} _Nullable` : generatedType;
  }

  const realTypeAnnotation =
    typeAnnotation.type === 'TypeAliasTypeAnnotation'
      ? getTypeAliasTypeAnnotation(typeAnnotation.name, aliases)
      : typeAnnotation;
  switch (realTypeAnnotation.type) {
    case 'ReservedFunctionValueTypeAnnotation':
      switch (realTypeAnnotation.name) {
        case 'RootTag':
          return nullable ? 'NSNumber *' : 'double';
        default:
          (realTypeAnnotation.name: empty);
          throw new Error(createErrorMessage(realTypeAnnotation.name));
      }
    case 'StringTypeAnnotation':
      return wrapIntoNullableIfNeeded('NSString *');
    case 'NumberTypeAnnotation':
    case 'FloatTypeAnnotation':
    case 'Int32TypeAnnotation':
      return nullable ? 'NSNumber *' : 'double';
    case 'BooleanTypeAnnotation':
      return nullable ? 'NSNumber * _Nullable' : 'BOOL';
    case 'ObjectTypeAnnotation':
      if (typeAnnotation.type === 'TypeAliasTypeAnnotation') {
        return getNamespacedStructName(typeAnnotation.name) + ' &';
      }
      return wrapIntoNullableIfNeeded('NSDictionary *');
    case 'GenericObjectTypeAnnotation':
      return wrapIntoNullableIfNeeded('NSDictionary *');
    case 'ArrayTypeAnnotation':
      return wrapIntoNullableIfNeeded('NSArray *');
    case 'FunctionTypeAnnotation':
      return 'RCTResponseSenderBlock';
    default:
      // TODO (T65847278): Figure out why this does not work.
      // (type: empty);
      throw new Error(createErrorMessage(realTypeAnnotation.type));
  }
}

function translatePrimitiveJSTypeToObjCTypeForReturn(
  typeAnnotation: FunctionTypeAnnotationReturn,
  createErrorMessage: (typeName: string) => string,
) {
  function wrapIntoNullableIfNeeded(generatedType: string) {
    return typeAnnotation.nullable
      ? `${generatedType} _Nullable`
      : generatedType;
  }
  switch (typeAnnotation.type) {
    case 'ReservedFunctionValueTypeAnnotation':
      switch (typeAnnotation.name) {
        case 'RootTag':
          return wrapIntoNullableIfNeeded('NSNumber *');
        default:
          (typeAnnotation.name: empty);
          throw new Error(createErrorMessage(typeAnnotation.name));
      }
    case 'VoidTypeAnnotation':
    case 'GenericPromiseTypeAnnotation':
      return 'void';
    case 'StringTypeAnnotation':
      return wrapIntoNullableIfNeeded('NSString *');
    case 'NumberTypeAnnotation':
    case 'FloatTypeAnnotation':
    case 'Int32TypeAnnotation':
      return wrapIntoNullableIfNeeded('NSNumber *');
    case 'BooleanTypeAnnotation':
      return typeAnnotation.nullable ? 'NSNumber * _Nullable' : 'BOOL';
    case 'GenericObjectTypeAnnotation':
      return wrapIntoNullableIfNeeded('NSDictionary *');
    case 'ArrayTypeAnnotation':
      return wrapIntoNullableIfNeeded('NSArray<id<NSObject>> *');
    case 'ObjectTypeAnnotation':
      return wrapIntoNullableIfNeeded('NSDictionary *');
    default:
      // TODO (T65847278): Figure out why this does not work.
      // (typeAnnotation.type: empty);
      throw new Error(createErrorMessage(typeAnnotation.type));
  }
}

function handleArrayOfObjects(
  objectForGeneratingStructs: Array<ObjectForGeneratingStructs>,
  propOrParam: FunctionTypeAnnotationParam,
  name: string,
) {
  if (
    propOrParam.typeAnnotation.type === 'ArrayTypeAnnotation' &&
    propOrParam.typeAnnotation.elementType
  ) {
    const typeAnnotation = propOrParam.typeAnnotation.elementType;
    const type = typeAnnotation.type;

    if (
      type === 'ObjectTypeAnnotation' &&
      typeAnnotation.properties &&
      typeAnnotation.properties.length > 0
    ) {
      objectForGeneratingStructs.push({
        name,
        object: {
          type: 'ObjectTypeAnnotation',
          properties: typeAnnotation.properties,
        },
      });
    }
  }
}

const methodImplementationTemplate =
  '- (::_RETURN_VALUE_::) ::_PROPERTY_NAME_::::_ARGS_::;';

module.exports = {
  generate(
    libraryName: string,
    schema: SchemaType,
    moduleSpecName: string,
  ): FilesOutput {
    const nativeModules = Object.keys(schema.modules)
      .sort()
      .map(moduleName => {
        const modules = schema.modules[moduleName].nativeModules;
        if (modules == null) {
          return null;
        }

        return modules;
      })
      .filter(Boolean)
      .reduce((acc, components) => Object.assign(acc, components), {});

    const modules = Object.keys(nativeModules)
      .map(name => moduleTemplate.replace(/::_MODULE_NAME_::/g, name))
      .join('\n');

    const protocols = Object.keys(nativeModules)
      .sort()
      .map(name => {
        const objectForGeneratingStructs: Array<ObjectForGeneratingStructs> = [];
        const {aliases, properties} = nativeModules[name];
        const implementations = properties
          .map(prop => {
            const nativeArgs = prop.typeAnnotation.params
              .map((param, i) => {
                let paramObjCType;
                if (
                  param.typeAnnotation.type === 'ObjectTypeAnnotation' &&
                  param.typeAnnotation.properties
                ) {
                  const variableName =
                    capitalizeFirstLetter(prop.name) +
                    capitalizeFirstLetter(param.name);
                  const structName = 'Spec' + variableName;
                  objectForGeneratingStructs.push({
                    name: structName,
                    object: {
                      type: 'ObjectTypeAnnotation',
                      properties: param.typeAnnotation.properties,
                    },
                  });
                  paramObjCType = getNamespacedStructName(structName) + ' &';

                  param.typeAnnotation.properties.map(aProp => {
                    return handleArrayOfObjects(
                      objectForGeneratingStructs,
                      aProp,
                      'Spec' +
                        capitalizeFirstLetter(prop.name) +
                        capitalizeFirstLetter(param.name) +
                        capitalizeFirstLetter(aProp.name) +
                        'Element',
                    );
                  });
                } else if (
                  param.typeAnnotation.type === 'TypeAliasTypeAnnotation'
                ) {
                  const typeAnnotation = getTypeAliasTypeAnnotation(
                    param.typeAnnotation.name,
                    aliases,
                  );
                  if (typeAnnotation.type === 'ObjectTypeAnnotation') {
                    paramObjCType =
                      getNamespacedStructName(param.typeAnnotation.name) + ' &';
                  } else {
                    throw Error(
                      `Unsupported type for "${param.typeAnnotation.name}". Found: ${typeAnnotation.type}`,
                    );
                  }
                } else {
                  paramObjCType = translatePrimitiveJSTypeToObjCType(
                    param,
                    typeName =>
                      `Unsupported type for param "${param.name}" in ${prop.name}. Found: ${typeName}`,
                    aliases,
                  );

                  handleArrayOfObjects(
                    objectForGeneratingStructs,
                    param,
                    'Spec' +
                      capitalizeFirstLetter(prop.name) +
                      capitalizeFirstLetter(param.name) +
                      'Element',
                  );
                }
                return `${i === 0 ? '' : param.name}:(${paramObjCType})${
                  param.name
                }`;
              })
              .join('\n   ')
              .concat(callbackArgs(prop));
            const {returnTypeAnnotation} = prop.typeAnnotation;
            if (
              returnTypeAnnotation.type === 'ObjectTypeAnnotation' &&
              returnTypeAnnotation.properties
            ) {
              objectForGeneratingStructs.push({
                name: 'Spec' + capitalizeFirstLetter(prop.name) + 'ReturnType',
                object: {
                  type: 'ObjectTypeAnnotation',
                  properties: returnTypeAnnotation.properties,
                },
              });
            }
            const implementation = methodImplementationTemplate
              .replace('::_PROPERTY_NAME_::', prop.name)
              .replace(
                '::_RETURN_VALUE_::',
                translatePrimitiveJSTypeToObjCTypeForReturn(
                  returnTypeAnnotation,
                  typeName =>
                    `Unsupported return type for ${prop.name}. Found: ${typeName}`,
                ),
              )
              .replace('::_ARGS_::', nativeArgs);
            if (prop.name === 'getConstants') {
              if (
                prop.typeAnnotation.returnTypeAnnotation.properties &&
                prop.typeAnnotation.returnTypeAnnotation.properties.length === 0
              ) {
                return '';
              }
              return constants.replace(/::_MODULE_NAME_::/, name);
            }
            return implementation;
          })
          .join('\n');

        Object.keys(aliases)
          .reverse()
          .map((aliasName, i) => {
            const alias = aliases[aliasName];

            let paramObjCType = '';

            switch (alias.type) {
              case 'ObjectTypeAnnotation':
                if (alias.properties) {
                  objectForGeneratingStructs.push({
                    name: aliasName,
                    object: {
                      type: 'ObjectTypeAnnotation',
                      properties: alias.properties,
                    },
                  });
                  paramObjCType = getNamespacedStructName(alias.name) + ' &';
                }
                break;
              default:
                throw Error(
                  `Unsupported type for "${aliasName}". Found: ${alias.type}`,
                );
            }
            return `${i === 0 ? '' : aliasName}:(${paramObjCType})${aliasName}`;
          })
          .join('\n');

        return protocolTemplate
          .replace(
            /::_STRUCTS_::/g,
            translateObjectsForStructs(
              objectForGeneratingStructs,
              name,
              aliases,
            ),
          )
          .replace(/::_MODULE_PROPERTIES_::/g, implementations)
          .replace(/::_MODULE_NAME_::/g, name)
          .replace('::_PROPERTIES_MAP_::', '');
      })
      .join('\n');

    const fileName = `${moduleSpecName}.h`;
    const replacedTemplate = template
      .replace(/::_MODULES_::/g, modules)
      .replace(/::_PROTOCOLS_::/g, protocols);

    return new Map([[fileName, replacedTemplate]]);
  },
};