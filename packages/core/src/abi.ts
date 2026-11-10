export const KPEG_TOKEN_ABI = [
  {
    type: "event",
    name: "KittyBatchMinted",
    anonymous: false,
    inputs: [
      { indexed: true, name: "owner", type: "address" },
      { indexed: true, name: "startKittyId", type: "uint256" },
      { indexed: false, name: "count", type: "uint256" },
      { indexed: false, name: "tier", type: "uint8" },
      { indexed: false, name: "batchSizeWhole", type: "uint256" },
      { indexed: false, name: "seedBase", type: "bytes32" }
    ]
  },
  {
    type: "event",
    name: "KittyBatchBurned",
    anonymous: false,
    inputs: [
      { indexed: true, name: "owner", type: "address" },
      { indexed: true, name: "startKittyId", type: "uint256" },
      { indexed: false, name: "count", type: "uint256" }
    ]
  },
  {
    type: "event",
    name: "KittyBatchMoved",
    anonymous: false,
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: true, name: "startKittyId", type: "uint256" },
      { indexed: false, name: "count", type: "uint256" }
    ]
  },
  {
    type: "event",
    name: "KittyMoved",
    anonymous: false,
    inputs: [
      { indexed: true, name: "kittyId", type: "uint256" },
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" }
    ]
  },
  {
    type: "event",
    name: "KittyOperatorApproval",
    anonymous: false,
    inputs: [
      { indexed: true, name: "owner", type: "address" },
      { indexed: true, name: "operator", type: "address" },
      { indexed: false, name: "approved", type: "bool" }
    ]
  },
  {
    type: "event",
    name: "KittyTransferApproval",
    anonymous: false,
    inputs: [
      { indexed: true, name: "owner", type: "address" },
      { indexed: true, name: "operator", type: "address" },
      { indexed: true, name: "kittyId", type: "uint256" },
      { indexed: false, name: "approved", type: "bool" }
    ]
  },
  {
    type: "event",
    name: "KittyTransferApprovalBatch",
    anonymous: false,
    inputs: [
      { indexed: true, name: "owner", type: "address" },
      { indexed: true, name: "operator", type: "address" },
      { indexed: false, name: "count", type: "uint256" },
      { indexed: false, name: "approved", type: "bool" }
    ]
  },
  {
    type: "event",
    name: "BornKPEGMinted",
    anonymous: false,
    inputs: [
      { indexed: true, name: "owner", type: "address" },
      { indexed: true, name: "kittyId", type: "uint256" },
      { indexed: false, name: "tier", type: "uint8" },
      { indexed: false, name: "seedSalt", type: "bytes32" },
      { indexed: false, name: "packedTraits", type: "uint256" }
    ]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" }
    ],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "renderer",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "breedingContract",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "breedingContractCodeHash",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "getKitty",
    inputs: [{ name: "kittyId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "owner", type: "address" },
          { name: "tier", type: "uint8" },
          { name: "seed", type: "bytes32" },
          { name: "traits", type: "uint256" },
          { name: "alive", type: "bool" }
        ]
      }
    ]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "kittySvg",
    inputs: [{ name: "kittyId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "tokenURI",
    inputs: [{ name: "kittyId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "getOwnerKitties",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "ownsKitties",
    inputs: [
      { name: "account", type: "address" },
      { name: "kittyIds", type: "uint256[]" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "ownerKittiesLive",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "directTransferKitty",
    inputs: [
      { name: "kittyId", type: "uint256" },
      { name: "to", type: "address" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "directTransferKittiesList",
    inputs: [
      { name: "to", type: "address" },
      { name: "kittyIds", type: "uint256[]" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "setKittyOperator",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "kittyOperatorApproved",
    inputs: [
      { name: "owner", type: "address" },
      { name: "operator", type: "address" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "setKittyTransferApproval",
    inputs: [
      { name: "operator", type: "address" },
      { name: "kittyIds", type: "uint256[]" },
      { name: "approved", type: "bool" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "kittyTransferApprovedFor",
    inputs: [
      { name: "owner_", type: "address" },
      { name: "operator", type: "address" },
      { name: "kittyId", type: "uint256" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "kittiesTransferApprovedFor",
    inputs: [
      { name: "owner_", type: "address" },
      { name: "operator", type: "address" },
      { name: "kittyIds", type: "uint256[]" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "directTransferKittiesListFrom",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "kittyIds", type: "uint256[]" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "setBreedingContract",
    inputs: [
      { name: "newBreedingContract", type: "address" },
      { name: "expectedCodeHash", type: "bytes32" }
    ],
    outputs: []
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "replaceBornKPEG",
    inputs: [
      { name: "backingKittyId", type: "uint256" },
      { name: "childCustody", type: "address" },
      { name: "tier", type: "uint8" },
      { name: "seedSalt", type: "bytes32" },
      { name: "packedTraits", type: "uint256" }
    ],
    outputs: [{ name: "kittyId", type: "uint256" }]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "started",
    inputs: [],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "notMintableAccount",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "maxBuy",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "kittiesLive",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "kittiesEverMinted",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  }
] as const;

export const KPEG_BREEDING_ABI = [
  {
    type: "event",
    name: "BreedingPoolCreated",
    anonymous: false,
    inputs: [
      { indexed: true, name: "poolId", type: "uint256" },
      { indexed: true, name: "host", type: "address" },
      { indexed: false, name: "poolType", type: "uint8" },
      { indexed: false, name: "parentA", type: "uint256" },
      { indexed: false, name: "parentB", type: "uint256" },
      { indexed: false, name: "cycleStartedAt", type: "uint64" },
      { indexed: false, name: "cycleDays", type: "uint16" },
      { indexed: false, name: "filterCount", type: "uint8" },
      { indexed: false, name: "filterGroups", type: "uint8[5]" },
      { indexed: false, name: "filterTraits", type: "uint8[5]" }
    ]
  },
  {
    type: "event",
    name: "BreedingSettled",
    anonymous: false,
    inputs: [
      { indexed: true, name: "poolId", type: "uint256" },
      { indexed: false, name: "result", type: "uint8" },
      { indexed: false, name: "childTier", type: "uint8" },
      { indexed: false, name: "childKittyId", type: "uint256" },
      { indexed: false, name: "claimId", type: "uint256" },
      { indexed: false, name: "childOwner", type: "address" },
      { indexed: false, name: "childSeedSalt", type: "bytes32" },
      { indexed: false, name: "childPackedTraits", type: "uint256" }
    ]
  },
  {
    type: "event",
    name: "BreedingCycleReset",
    anonymous: false,
    inputs: [
      { indexed: true, name: "poolId", type: "uint256" },
      { indexed: false, name: "cycleStartedAt", type: "uint64" },
      { indexed: false, name: "cycleDays", type: "uint16" },
      { indexed: false, name: "status", type: "uint8" }
    ]
  },
  {
    type: "event",
    name: "BreedingClaimed",
    anonymous: false,
    inputs: [
      { indexed: true, name: "claimId", type: "uint256" },
      { indexed: true, name: "poolId", type: "uint256" },
      { indexed: true, name: "childKittyId", type: "uint256" },
      { indexed: false, name: "owner", type: "address" }
    ]
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "createPrivatePool",
    inputs: [
      { name: "parentA", type: "uint256" },
      { name: "parentB", type: "uint256" },
      { name: "backingKittyId", type: "uint256" }
    ],
    outputs: [{ name: "poolId", type: "uint256" }]
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "createPublicPool",
    inputs: [
      { name: "parent", type: "uint256" },
      { name: "filterGroups", type: "uint8[]" },
      { name: "filterTraits", type: "uint8[]" }
    ],
    outputs: [{ name: "poolId", type: "uint256" }]
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "joinPublicPool",
    inputs: [
      { name: "poolId", type: "uint256" },
      { name: "parent", type: "uint256" }
    ],
    outputs: []
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "stakeBacking",
    inputs: [
      { name: "poolId", type: "uint256" },
      { name: "backingKittyId", type: "uint256" }
    ],
    outputs: []
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "withdrawBacking",
    inputs: [{ name: "poolId", type: "uint256" }],
    outputs: []
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "leavePool",
    inputs: [{ name: "poolId", type: "uint256" }],
    outputs: []
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "settle",
    inputs: [{ name: "poolId", type: "uint256" }],
    outputs: []
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "claimChild",
    inputs: [{ name: "claimId", type: "uint256" }],
    outputs: []
  },
  {
    type: "function",
    stateMutability: "view",
    name: "pools",
    inputs: [{ name: "poolId", type: "uint256" }],
    outputs: [
      { name: "poolType", type: "uint8" },
      { name: "status", type: "uint8" },
      { name: "host", type: "address" },
      { name: "joiner", type: "address" },
      { name: "parentA", type: "uint256" },
      { name: "parentB", type: "uint256" },
      { name: "parentAOwner", type: "address" },
      { name: "parentBOwner", type: "address" },
      { name: "cycleStartedAt", type: "uint64" },
      { name: "cycleDays", type: "uint16" },
      { name: "currentBackingProvider", type: "address" },
      { name: "currentBackingKittyId", type: "uint256" },
      { name: "currentBackingSide", type: "uint8" },
      { name: "queuedBackingProvider", type: "address" },
      { name: "queuedBackingKittyId", type: "uint256" },
      { name: "queuedBackingSide", type: "uint8" },
      { name: "filterCount", type: "uint8" },
      { name: "filterGroups", type: "uint8[5]" },
      { name: "filterTraits", type: "uint8[5]" }
    ]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "claims",
    inputs: [{ name: "claimId", type: "uint256" }],
    outputs: [
      { name: "poolId", type: "uint256" },
      { name: "childKittyId", type: "uint256" },
      { name: "childOwner", type: "address" },
      { name: "claimed", type: "bool" },
      { name: "createdAt", type: "uint64" }
    ]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "nextPoolId",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "nextClaimId",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  }
] as const;

export const KPEG_MARKET_ABI = [
  {
    type: "event",
    name: "PositionCreated",
    anonymous: false,
    inputs: [
      { indexed: true, name: "tradeId", type: "uint256" },
      { indexed: true, name: "seller", type: "address" },
      { indexed: true, name: "escrowAddress", type: "address" },
      { indexed: false, name: "paymentToken", type: "address" },
      { indexed: false, name: "price", type: "uint256" },
      { indexed: false, name: "kittyIds", type: "uint256[]" },
      { indexed: false, name: "feeBps", type: "uint256" }
    ]
  },
  {
    type: "event",
    name: "PositionDeleted",
    anonymous: false,
    inputs: [
      { indexed: true, name: "tradeId", type: "uint256" },
      { indexed: true, name: "seller", type: "address" }
    ]
  },
  {
    type: "event",
    name: "PositionBought",
    anonymous: false,
    inputs: [
      { indexed: true, name: "tradeId", type: "uint256" },
      { indexed: true, name: "buyer", type: "address" },
      { indexed: true, name: "seller", type: "address" },
      { indexed: false, name: "price", type: "uint256" },
      { indexed: false, name: "feeAmount", type: "uint256" }
    ]
  },
  {
    type: "event",
    name: "PositionParamsSet",
    anonymous: false,
    inputs: [
      { indexed: true, name: "tradeId", type: "uint256" },
      { indexed: true, name: "paymentToken", type: "address" },
      { indexed: false, name: "price", type: "uint256" }
    ]
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "createTradeAndFund",
    inputs: [
      { name: "paymentToken", type: "address" },
      { name: "price", type: "uint256" },
      { name: "kittyIds", type: "uint256[]" }
    ],
    outputs: [
      { name: "tradeId", type: "uint256" },
      { name: "escrowAddress", type: "address" }
    ]
  },
  {
    type: "function",
    stateMutability: "payable",
    name: "buyAndClaimAll",
    inputs: [
      { name: "tradeId", type: "uint256" },
      { name: "expectedPaymentToken", type: "address" },
      { name: "maxPrice", type: "uint256" }
    ],
    outputs: []
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "setPositionParams",
    inputs: [
      { name: "tradeId", type: "uint256" },
      { name: "paymentToken", type: "address" },
      { name: "price", type: "uint256" }
    ],
    outputs: []
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "deletePosition",
    inputs: [{ name: "tradeId", type: "uint256" }],
    outputs: []
  },
  {
    type: "function",
    stateMutability: "view",
    name: "token",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "getPositionView",
    inputs: [{ name: "tradeId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "tradeId", type: "uint256" },
          { name: "seller", type: "address" },
          { name: "buyer", type: "address" },
          { name: "escrowAddress", type: "address" },
          { name: "paymentToken", type: "address" },
          { name: "price", type: "uint256" },
          { name: "feeBps", type: "uint256" },
          { name: "kittyIds", type: "uint256[]" },
          { name: "status", type: "uint8" },
          { name: "ready", type: "bool" }
        ]
      }
    ]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "getOpenPositions",
    inputs: [
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" }
    ],
    outputs: [{ name: "", type: "uint256[]" }]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "getOpenPositionsByOwner",
    inputs: [
      { name: "account", type: "address" },
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" }
    ],
    outputs: [{ name: "", type: "uint256[]" }]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "getPurchasedPositions",
    inputs: [
      { name: "account", type: "address" },
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" }
    ],
    outputs: [{ name: "", type: "uint256[]" }]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "getCompletedPositions",
    inputs: [
      { name: "account", type: "address" },
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" }
    ],
    outputs: [{ name: "", type: "uint256[]" }]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "feeBps",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "feeRecipient",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
  }
] as const;

export const KPEG_ROUTER_ABI = [
  {
    type: "function",
    stateMutability: "payable",
    name: "buyExactKPEG",
    inputs: [
      { name: "exactKPEGOut", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "deadline", type: "uint256" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
      { name: "hookData", type: "bytes" }
    ],
    outputs: [{ name: "ethUsed", type: "uint256" }]
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "sellExactKPEG",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "minEthOut", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "deadline", type: "uint256" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
      { name: "hookData", type: "bytes" }
    ],
    outputs: [{ name: "ethOut", type: "uint256" }]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "tokenIsCurrency0",
    inputs: [],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "poolInitialized",
    inputs: [],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "getPoolKey",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" }
        ]
      }
    ]
  }
] as const;

export const KPEG_QUOTER_ABI = [
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "quoteExactOutputSingle",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          {
            name: "poolKey",
            type: "tuple",
            components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" }
            ]
          },
          { name: "zeroForOne", type: "bool" },
          { name: "exactAmount", type: "uint128" },
          { name: "hookData", type: "bytes" }
        ]
      }
    ],
    outputs: [
      { name: "amountIn", type: "uint256" },
      { name: "gasEstimate", type: "uint256" }
    ]
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "quoteExactInputSingle",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          {
            name: "poolKey",
            type: "tuple",
            components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" }
            ]
          },
          { name: "zeroForOne", type: "bool" },
          { name: "exactAmount", type: "uint128" },
          { name: "hookData", type: "bytes" }
        ]
      }
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "gasEstimate", type: "uint256" }
    ]
  }
] as const;
