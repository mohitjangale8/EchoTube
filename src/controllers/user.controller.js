import {asyncHandler} from "../utils/asyncHandler.js"
import {ApiError} from "../utils/ApiError.js"
import {User} from "../models/user.models.js"
import {uploadOnCloudinary} from "../utils/cloudinary.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import jwt from "jsonwebtoken"
import mongoose from "mongoose"
import { Subscription } from "../models/subscription.models.js"

const generateAccessAndRefreshTokens = async(userId) =>{
    try {
        const user = await User.findById(userId)
        const accessToken = user.generateAccessToken()
        const refreshToken = user.generateRefreshToken()

        user.refreshToken = refreshToken
        await user.save({ validateBeforeSave: false })

        return {accessToken, refreshToken}


    } catch (error) {
        throw new ApiError(500, "Something went wrong while generating refresh and access token")
    }
}

const registerUser = asyncHandler( async(req,res)=>{
    //get user details from frontend
    //validation - not Empty
    //Check if user already Exists - username, email
    //check for images, check for avatar
    //upload them to cloudinary, avatar
    //create user object - create an entry in db
    //remove password and refresh token field form response
    //check for user creation
    //return response

    const {fullName, email, username, password} = req.body
    //console.log(fullName, email, username, password)

    if(
        [fullName, email, username, password]
        .some(
                 (field)=> field?.trim()===""
            )
        )
        {
            throw new ApiError(400,"All Fields are Required")
        }

        const existedUser = await User.findOne({
            $or: [{ username },{ email }]
        })

        if(existedUser){
            throw new ApiError(409,"User with email or username already Exists !!")
        }

        const avatarLocalPath = req.files?.avatar[0]?.path;
        //const coverImageLocalPath = req.files?.coverImage[0]?.path;

        let coverImageLocalPath;
        if (req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0) {
            coverImageLocalPath = req.files.coverImage[0].path
        }

        if(avatarLocalPath == null){
            throw new ApiError(400,"Avatar File is Required")
        }

        const avatar= await uploadOnCloudinary(avatarLocalPath)
        const coverImage = await uploadOnCloudinary(coverImageLocalPath)

        if(!avatar){
            throw new ApiError(400,"Avatar File is Required")
        }

        const user = await User.create({
            fullName,
            avatar: avatar.url,
            coverImage: coverImage?.url || "",
            email,
            password,
            username: username.toLowerCase()
        })

        const createdUser = await User.findById(user._id).select(
            "-password -refreshToken"
        )

        if (!createdUser){
            throw new ApiError(500,"Something Went Wrong Whil registering the User")
        }

        return res.status(201).json(new ApiResponse(200,createdUser,"User Registered Successfully !!"))
})

const loginUser = asyncHandler(async(req,res)=>{
    //req body se data le aao
    // username or email login 
    //find the user in db
    // pswd check
    //access and refresh token generate
    //send cookie

    const {email,username,password} = req.body
    if(!(username || email)){
        throw new ApiError(400,"Username or Email is Required")
    }

    const user= await User.findOne({
        $or:[{username},{email}]
    })

    if(!user){
        throw new ApiError(404,"User does not Exists !!")
    }

    const isPasswordValid = await user.isPasswordCorrect(password)

    if(!isPasswordValid){
        throw new ApiError(401,"Invalid User Credentials !!")
    }
    
    const {accessToken,refreshToken} = await generateAccessAndRefreshTokens(user._id)

    const loggedInUser = await User.findById(user._id)
    .select("-password -refreshToken")

    const options = {
        httpOnly: true,
        secure : true
    }

     return res
               .status(200)
               .cookie("accessToken",accessToken,options)
               .cookie("refreshToken",refreshToken,options) 
               .json( 
                new ApiResponse(
                    200,
                    {user: loggedInUser,accessToken,refreshToken},
                    "User Logged in Successfully !"
                ))
})

const logOutUser = asyncHandler(async(req,res)=>{
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $unset:{
                refreshToken: 1
            }
        },
        {
            new:true            
        }
    )
    const options = {
        httpOnly: true,
        secure : true
    }

    return res
              .status(200)
              .clearCookie("accessToken",options)
              .clearCookie("refreshToken",options)
              .json(
                new ApiResponse(
                    200,
                    {},
                    "User logged Out"
                )
              )

})

const refreshAccessToken = asyncHandler(async (req,res) =>{

    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken

    if(!incomingRefreshToken){
        throw new ApiError(401,"unauthorized Request !!")
    }

    try {
        const decodedToken = jwt.verify(incomingRefreshToken,process.env.REFRESH_TOKEN_SECRET)
        const user =await User.findById(decodedToken?._id)
        if(!user){
            throw new ApiError(401,"Invalid Refresh Token !!")
        }
        if(incomingRefreshToken !== user?.refreshToken){
            throw new ApiError(401,"Refresh Token is Expired or Used!")
        }
    
        const options ={
            httpOnly:true,
            secure:true
        }
    
        const {accessToken,refreshToken:newRefreshToken} =await generateAccessAndRefreshTokens(user._id)        
    
        return res
                  .status(200)
                  .cookie("accessToken",accessToken,options)
                  .cookie("refreshToken",newRefreshToken,options)
                  .json(
                    new ApiResponse(
                        200,
                        {accessToken, refreshToken : newRefreshToken},
                        "Access Token Refreshed"
    
                    )
                  )
    } catch (error) {

        throw new ApiError(401, error?.message || "Invalid Refresh Token")

    }


})

const changeCurrentPassword = asyncHandler(async(req,res) => {
    
    const {oldPassword, newPassword} = req.body

    const user = await User.findById(req.user?._id)
    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword)

    if(!isPasswordCorrect){
        throw new ApiError(400,"Invalid Old Password")
    }

    user.password = newPassword
    await user.save({validateBeforeSave:false})

    return res
              .status(200)
              .json(new ApiResponse(200,{}, "Password Changed Successfully !"))

})


const getCurrentUser = asyncHandler(async(req,res) => {
    return res
              .status(200)
              .json(new ApiResponse(200,req.user,"Currrent User Fetched Successfully !!"))
})


const updateAccountDetails = asyncHandler(async(req,res) => {
    const {fullName, email} = req.body

    if (!fullName || !email){
        throw new ApiError(400, "All Fields are Required")
    }

    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set:{
                fullName,
                email,
            }
        },
        {new:true}
    ).select("-password")

    return res
              .status(200)
              .json(new ApiResponse(200,user,"Account Details Updated Successfully !"))

})

const updateUserAvatar = asyncHandler(async(req,res) => {
    const avatarLocalPath = req.file?.path

    if(!avatarLocalPath){
        throw new ApiError(400,"Avatar File is Missing !!")
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath)

    if (!avatar.url){
        throw new ApiError(400,"Error While uploading on Avatar")
    }

    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set:{
                avatar:avatar.url
            }
        },
        {new:true}
    ).select("-password")

    return res   
              .status(200)
              .json(200,user,"Avatar Updated Successfully !! ")

})

const updateUserCoverImage = asyncHandler(async(req,res) => {

    const coverImageLocalPath = req.file?.path

    if(!coverImageLocalPath){
        throw new ApiError(400,"Cover Image File is Missing !!")
    }

    const coverImage = await uploadOnCloudinary(coverImageLocalPath)

    if (!coverImage.url){
        throw new ApiError(400,"Error While uploading on Cover Image")
    }

    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set:{
                coverImage:coverImage.url
            }
        },
        {new:true}
    ).select("-password")

    return res   
              .status(200)
              .json(200,user,"Cover Image Updated Successfully !! ")

})

const getUserChannelProfile = asyncHandler(async(req,res) =>{

    const {username} = req.params

    if(!username?.trim()){
        throw new ApiError(400, "username is Missing")
    }

    const channel = await User.aggregate([
        {
            $match:{
                username: username?.toLowerCase()
            }
        },
        {
            $lookup:{
                from : "subscriptions",
                localField : "_id",
                foreignField : "channel",
                as : "subscribers"
            }
        },
        {
            $lookup:{
                from : "subscriptions",
                localField : "_id",
                foreignField : "subscriber",
                as : "subscribedTo"  
            }
        },
        {
            $addFields : {
                subscribersCount:{
                    $size : "$subscribers"
                }, 
                channelsSubscribedToCount:{
                    $size : "$subscribedTo"
                },
                isSubscribed:{
                    $cond: {
                        if: {$in: [req.user?._id,"$subscribers.subscriber"]},
                        then: true,
                        else: false
                    }
                }
            }
        },
        {
            $project:{
                fullName: 1,
                username: 1,
                subscribersCount: 1,
                channelsSubscribedToCount: 1,
                isSubscribed: 1,
                avatar: 1,
                coverImage: 1,
                email: 1
            }
        }
    ])
    
    if(!channel?.length){
        throw new ApiError(404,"Channel Does not Exists !!")
    }

    return res
              .status(200)
              .json(new ApiResponse(200,channel[0],"User Channel Fetched Successfully"))

})

const getWatchHistory = asyncHandler(async(req,res)=>{

    const user = await User.aggregate([
        {
            $match:{
                _id: new mongoose.Types.ObjectId(req.user._id)
            }
        },
        {
            $lookup:{
                from: "videos",
                localField:"watchHistory",
                foreignField:"_id",
                as:"watchHistory",
                pipeline: [
                    {
                        $lookup:{
                            from:"users",
                            localField:"owner",
                            foreignField:"_id",
                            as:"owner",
                            pipeline:[
                                {
                                    $project:{
                                        fullName: 1,
                                        username: 1,
                                        avatar : 1
                                    }
                                }
                            ]
                        }
                    },
                    {
                        $addFields:{
                            owner:{
                                $first: "$owner"
                            }
                        }
                    }
                ]
            }
        }
    ])

    return res
              .status(200)
              .json(new ApiResponse(200,user[0].watchHistory,"Watch History Fetched Successfully !!"))

})

export {
    registerUser,
    loginUser,
    logOutUser,
    refreshAccessToken,
    changeCurrentPassword,
    getCurrentUser,
    updateAccountDetails,
    updateUserAvatar,
    updateUserCoverImage,
    getUserChannelProfile,
    getWatchHistory
}